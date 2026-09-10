import {
  createBundlerClient,
  createPaymasterClient,
} from "viem/account-abstraction"
import { concat, encodeFunctionData, http, isAddress, isHex, getAddress, parseUnits, formatUnits, maxUint256 } from "viem"
import { PIMLICO_PAYMASTER_V06_BASE, PIMLICO_RPC_BASE } from "./constants.js"
import { deriveSmartAccount, getSmartAccountState } from "./smart-account.js"

function normalizeIdentity(input) {
  if (input === undefined || input === null) return null
  if (typeof input !== "string" || !isHex(input)) {
    throw new TypeError("gripIdentity / identity must be a 0x-prefixed hex string")
  }
  // length budget: hex chars excluding "0x" / 2 = bytes. Cap at 128 bytes to avoid pathological growth.
  const byteLen = (input.length - 2) / 2
  if (byteLen === 0) return null
  if (byteLen > 128) {
    throw new TypeError(`identity blob exceeds 128 bytes (got ${byteLen})`)
  }
  return input
}

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
  gripIdentity,
}) {
  const defaultIdentity = normalizeIdentity(gripIdentity)
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

    async transfer({ to, amount, identity }) {
      if (!isAddress(to)) throw new TypeError(`Invalid recipient: ${to}`)
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new TypeError(`amount must be positive number, got: ${amount}`)
      }
      const stringAmount = String(amount)
      const decimals = stringAmount.includes(".") ? stringAmount.split(".")[1].length : 0
      if (decimals > USDC_DECIMALS) {
        throw new TypeError(`amount exceeds USDC granularity (max ${USDC_DECIMALS} decimals): ${amount}`)
      }

      // Per-call identity override beats client default. null disables explicitly.
      const identityBlob = identity === undefined
        ? defaultIdentity
        : normalizeIdentity(identity)

      // Resolve current state. Decoupled flags:
      //   isAccountDeployed (immutable once true) drives whether initCode is needed.
      //   isPaymasterApproved drives whether ERC20 paymaster mode is viable for steady state.
      const state = await this.state()
      const needsBootstrap = !state.deployed || state.paymasterAllowance === 0n

      const transferCall = {
        to: network.usdc,
        data: encodeFunctionData({
          abi: USDC_ABI,
          functionName: "transfer",
          args: [getAddress(to), parseUnits(stringAmount, USDC_DECIMALS)],
        }),
      }
      const approveCall = {
        to: network.usdc,
        data: encodeFunctionData({
          abi: USDC_ABI,
          functionName: "approve",
          args: [paymasterAddress, maxUint256],
        }),
      }

      // First payment: sponsored bundler runs [approve, transfer] in one atomic UserOp.
      //   - kills the bootstrap→transfer race that AA10s against Pimlico when getCode is stale
      //   - saves ~30% gas vs running two UserOps (one verificationGas instead of two)
      // Steady state: ERC20 paymaster runs single transfer call, smart account pays gas in USDC.
      const bundler = needsBootstrap ? bundlerSponsoredBootstrap : bundlerErc20Paymaster
      const calls = needsBootstrap ? [approveCall, transferCall] : [transferCall]

      // Identity blob: encode calls into callData, then append the blob bytes.
      // Solidity ABI decoders ignore trailing bytes after the expected args, so
      // execute(...) / executeBatch(...) still decodes correctly. The blob lands
      // on-chain in the UserOp callData and can be parsed by indexers for
      // per-agent attribution. Same pattern Safe uses.
      let sendArgs
      if (identityBlob) {
        const baseCallData = await smartAccount.encodeCalls(calls)
        const finalCallData = concat([baseCallData, identityBlob])
        sendArgs = { callData: finalCallData }
      } else {
        sendArgs = { calls }
      }

      const opHash = await bundler.sendUserOperation(sendArgs)
      const receipt = await bundler.waitForUserOperationReceipt({ hash: opHash })
      return {
        opHash,
        hash: receipt.receipt.transactionHash,
        status: receipt.success ? "confirmed" : "failed",
        basescanUrl: `${network.explorer}/tx/${receipt.receipt.transactionHash}`,
        blockNumber: receipt.receipt.blockNumber.toString(),
        bootstrapped: needsBootstrap ? receipt.receipt.transactionHash : null,
        identity: identityBlob,
        paymaster: receipt.paymaster,
      }
    },
  }
}
