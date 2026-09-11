import {
  createBundlerClient,
  createPaymasterClient,
} from "viem/account-abstraction"
import { concat, encodeFunctionData, http, isAddress, isHex, getAddress, parseUnits } from "viem"
import {
  BOOTSTRAP_USDC_BUDGET_RAW,
  PAYMASTER_USDC_REFILL_THRESHOLD_RAW,
  PIMLICO_PAYMASTER_V06_BASE,
  PIMLICO_RPC_BASE,
} from "./constants.js"
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
  // Used for undeployed accounts or zero allowance; positive-allowance refills use ERC20.
  const bundlerSponsoredBootstrap = createBundlerClient({
    account: smartAccount,
    client: publicClient,
    transport: http(transportUrl),
    paymaster: paymasterClient,
  })

  // Steady-state bundler: ERC20 mode (smart account pays gas in USDC automatically).
  // Includes refills: approval and transfer execute together, paid by the smart account.
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
      const needsSponsorship = !s.deployed || s.paymasterAllowance === 0n
      if (!needsSponsorship && s.usdcBalance === 0n) {
        throw new RangeError("Insufficient USDC for paymaster gas; fund the smart account and retry.")
      }
      const bundler = needsSponsorship ? bundlerSponsoredBootstrap : bundlerErc20Paymaster
      // Explicit setup can replenish allowance on its own. transfer() batches it with payment.
      // Never retry an ERC20 failure using sponsorship: funding/provider errors stay visible.
      const opHash = await bundler.sendUserOperation({
        calls: [{
          to: network.usdc,
          data: encodeFunctionData({
            abi: USDC_ABI,
            functionName: "approve",
            args: [paymasterAddress, BOOTSTRAP_USDC_BUDGET_RAW],
          }),
        }],
      })
      const receipt = await bundler.waitForUserOperationReceipt({ hash: opHash })
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

      // Approval replenishment and gas sponsorship are separate decisions.
      const state = await this.state()
      const needsAllowanceRefill = !state.deployed || state.paymasterAllowance < PAYMASTER_USDC_REFILL_THRESHOLD_RAW
      const needsSponsorship = !state.deployed || state.paymasterAllowance === 0n
      const amountRaw = parseUnits(stringAmount, USDC_DECIMALS)
      const recipient = getAddress(to)
      const transfersFullBalance = state.usdcBalance === amountRaw && recipient !== getAddress(smartAccount.address)
      if (state.usdcBalance < amountRaw || (!needsSponsorship && transfersFullBalance)) {
        throw new RangeError("Insufficient USDC for transfer and paymaster gas; fund the smart account and retry.")
      }

      const transferCall = {
        to: network.usdc,
        data: encodeFunctionData({
          abi: USDC_ABI,
          functionName: "transfer",
          args: [recipient, amountRaw],
        }),
      }
      const approveCall = {
        to: network.usdc,
        data: encodeFunctionData({
          abi: USDC_ABI,
          functionName: "approve",
          args: [paymasterAddress, BOOTSTRAP_USDC_BUDGET_RAW],
        }),
      }

      // First payment: sponsored bundler runs [approve, transfer] in one atomic UserOp.
      //   - kills the bootstrap→transfer race that AA10s against Pimlico when getCode is stale
      //   - saves ~30% gas vs running two UserOps (one verificationGas instead of two)
      // Positive allowance below the threshold: ERC20 mode runs the same atomic batch.
      // Pimlico Singleton can collect tokens in postOp, after approve has executed.
      // Provider validation still decides gas affordability; failures never trigger sponsorship.
      const bundler = needsSponsorship ? bundlerSponsoredBootstrap : bundlerErc20Paymaster
      const calls = needsAllowanceRefill ? [approveCall, transferCall] : [transferCall]

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
        bootstrapped: needsSponsorship ? receipt.receipt.transactionHash : null,
        identity: identityBlob,
        paymaster: receipt.paymaster,
      }
    },
  }
}
