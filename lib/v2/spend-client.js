import {
  createBundlerClient,
  createPaymasterClient,
} from "viem/account-abstraction"
import { encodeFunctionData, http, isAddress, getAddress, parseUnits, formatUnits, maxUint256 } from "viem"
import { PIMLICO_PAYMASTER_V06_BASE, PIMLICO_RPC_BASE } from "./constants.js"
import { deriveSmartAccount, getSmartAccountState } from "./smart-account.js"

const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
]

export const USDC_DECIMALS = 6

export async function createSpendClient({
  owner,
  publicClient,
  network,
  pimlicoApiKey,
  gripApiUrl,
  paymasterAddress = PIMLICO_PAYMASTER_V06_BASE,
}) {
  if (!pimlicoApiKey && !gripApiUrl) {
    throw new TypeError(
      "createSpendClient requires either { pimlicoApiKey } or { gripApiUrl }. " +
      "Use gripApiUrl for the Grip-managed proxy (no signup), or pimlicoApiKey for BYOK.",
    )
  }
  const smartAccount = await deriveSmartAccount({ owner, publicClient })
  // Resolve transport: gripApiUrl takes precedence (managed mode). Otherwise direct Pimlico.
  const transportUrl = gripApiUrl || PIMLICO_RPC_BASE(pimlicoApiKey)
  const paymasterClient = createPaymasterClient({ transport: http(transportUrl) })

  // Bootstrap bundler: sponsored mode (Pimlico verifying paymaster pays gas, billed to our balance).
  // Used ONCE per smart account on first use to deploy + approve(paymaster, MAX).
  const bundlerSponsoredBootstrap = createBundlerClient({
    account: smartAccount,
    client: publicClient,
    transport: http(transportUrl),
    paymaster: paymasterClient,
  })

  // Steady-state bundler: ERC20 mode (smart account pays gas in USDC automatically).
  // Used for every UserOp after bootstrap. Self-sustaining, costs us nothing per tx.
  const bundlerErc20Paymaster = createBundlerClient({
    account: smartAccount,
    client: publicClient,
    transport: http(transportUrl),
    paymaster: paymasterClient,
    paymasterContext: { token: network.usdc },
  })

  return {
    smartAccount,
    address: smartAccount.address,
    publicClient,
    network,
    paymasterAddress,
    bundlerSelfPaying: bundlerErc20Paymaster,
    bundlerErc20Paymaster,

    async state() {
      return await getSmartAccountState({
        smartAccount,
        paymasterAddress,
        publicClient,
        network,
      })
    },

    async ensureBootstrapped() {
      const s = await this.state()
      if (s.bootstrapped) return { alreadyDone: true, ...s }
      // Bootstrap = sponsored UserOp that deploys the smart account AND approves the paymaster
      // for max USDC. From this point on, all UserOps run in ERC20 mode (user pays gas in USDC).
      // The sponsored mode bills our Pimlico balance — ~$0.05 USD per new user (one-time CAC).
      const opHash = await bundlerSponsoredBootstrap.sendUserOperation({
        calls: [{
          to: network.usdc,
          data: encodeFunctionData({
            abi: USDC_ABI,
            functionName: "approve",
            args: [paymasterAddress, maxUint256],
          }),
        }],
      })
      const receipt = await bundlerSponsoredBootstrap.waitForUserOperationReceipt({ hash: opHash })
      return {
        alreadyDone: false,
        opHash,
        txHash: receipt.receipt.transactionHash,
        success: receipt.success,
        explorerUrl: `${network.explorer}/tx/${receipt.receipt.transactionHash}`,
      }
    },

    async transfer({ to, amount }) {
      if (!isAddress(to)) throw new TypeError(`Invalid recipient: ${to}`)
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new TypeError(`amount must be positive number, got: ${amount}`)
      }
      const stringAmount = String(amount)
      const decimals = stringAmount.includes(".") ? stringAmount.split(".")[1].length : 0
      if (decimals > USDC_DECIMALS) {
        throw new TypeError(`amount exceeds USDC granularity (max ${USDC_DECIMALS} decimals): ${amount}`)
      }

      // Auto-bootstrap if needed
      const bootstrap = await this.ensureBootstrapped()

      // Send transfer via ERC20 paymaster
      const opHash = await bundlerErc20Paymaster.sendUserOperation({
        calls: [{
          to: network.usdc,
          data: encodeFunctionData({
            abi: USDC_ABI,
            functionName: "transfer",
            args: [getAddress(to), parseUnits(stringAmount, USDC_DECIMALS)],
          }),
        }],
      })
      const receipt = await bundlerErc20Paymaster.waitForUserOperationReceipt({ hash: opHash })
      return {
        opHash,
        hash: receipt.receipt.transactionHash,
        status: receipt.success ? "confirmed" : "failed",
        basescanUrl: `${network.explorer}/tx/${receipt.receipt.transactionHash}`,
        blockNumber: receipt.receipt.blockNumber.toString(),
        bootstrapped: bootstrap.alreadyDone ? null : bootstrap.txHash,
        paymaster: receipt.paymaster,
      }
    },
  }
}
