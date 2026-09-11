import assert from "node:assert/strict"
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, keccak256, parseAbi, toHex } from "viem"
import { base } from "viem/chains"
import { ENTRY_POINT_V06, PIMLICO_PAYMASTER_V06_BASE } from "../../lib/v2/constants.js"

// Public disposable key. No request from this fixture can reach a network.
export const TEST_OWNER = `0x${"11".repeat(32)}`
export const TEST_RECIPIENT = "0x2222222222222222222222222222222222222222"
export const TEST_NETWORK = { usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://explorer.invalid" }
export const TEST_BUNDLER_URL = "https://bundler.invalid/rpc"
export const TEST_OP_HASH = `0x${"ab".repeat(32)}`
export const TEST_TX_HASH = `0x${"cd".repeat(32)}`
const FACTORY = "0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a"
const FACTORY_ABI = parseAbi(["function getAddress(bytes[] owners, uint256 nonce) view returns (address)"])
const NONCE_ABI = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"])
export const TOKEN_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
])

/** Strict RPC fixture. Exercises viem encoding, signing and submission, not EVM execution. */
export function createOfflineRpc(t, {
  deployed = true, allowance = 2_000_000n, usdcBalance = 10_000_000n,
  ethBalance = 0n, receiptSuccess = true, failMethod,
} = {}) {
  const requests = []
  const unexpected = []
  const accountAddresses = new Set()
  const state = { deployed, allowance, usdcBalance, ethBalance }
  const paymaster = PIMLICO_PAYMASTER_V06_BASE
  function assertAccount(address) {
    assert.ok(accountAddresses.has(address.toLowerCase()), `Unknown fixture account: ${address}`)
  }
  async function request({ method, params = [] }) {
    requests.push({ method, params })
    try {
      switch (method) {
        case "eth_chainId": return "0x2105"
        case "eth_getCode":
          assertAccount(params[0])
          return state.deployed ? "0x6000" : "0x"
        case "eth_getBalance":
          assertAccount(params[0])
          return toHex(state.ethBalance)
        case "eth_call": {
          const { to, data } = params[0]
          if (to.toLowerCase() === FACTORY) {
            const call = decodeFunctionData({ abi: FACTORY_ABI, data })
            assert.equal(call.functionName, "getAddress")
            assert.equal(call.args[0].length, 1)
            assert.equal(call.args[1], 0n)
            // Synthetic factory response: deliberately not a CREATE2 calculation.
            const address = getAddress(`0x${keccak256(data).slice(-40)}`)
            accountAddresses.add(address.toLowerCase())
            return encodeAbiParameters([{ type: "address" }], [address])
          }
          if (to.toLowerCase() === ENTRY_POINT_V06.toLowerCase()) {
            const call = decodeFunctionData({ abi: NONCE_ABI, data })
            assert.equal(call.functionName, "getNonce")
            assertAccount(call.args[0])
            return encodeAbiParameters([{ type: "uint256" }], [0n])
          }
          assert.equal(to.toLowerCase(), TEST_NETWORK.usdc.toLowerCase())
          const call = decodeFunctionData({ abi: TOKEN_ABI, data })
          assertAccount(call.args[0])
          if (call.functionName === "allowance") {
            assert.equal(call.args[1].toLowerCase(), paymaster.toLowerCase())
            return encodeAbiParameters([{ type: "uint256" }], [state.allowance])
          }
          assert.equal(call.functionName, "balanceOf")
          return encodeAbiParameters([{ type: "uint256" }], [state.usdcBalance])
        }
        case "eth_getBlockByNumber": return { number: "0x1", baseFeePerGas: "0x3b9aca00", transactions: [] }
        case "eth_maxPriorityFeePerGas": return "0xf4240"
        case "pm_getPaymasterStubData":
        case "pm_getPaymasterData":
          assert.equal(params[1].toLowerCase(), ENTRY_POINT_V06.toLowerCase())
          assert.equal(params[2], "0x2105")
          return { paymasterAndData: paymaster }
        case "eth_estimateUserOperationGas":
          return { callGasLimit: "0x186a0", verificationGasLimit: "0x186a0", preVerificationGas: "0xc350" }
        case "eth_sendUserOperation":
          assert.equal(params[1].toLowerCase(), ENTRY_POINT_V06.toLowerCase())
          assertAccount(params[0].sender)
          assert.ok(params[0].signature.length > 2)
          return TEST_OP_HASH
        case "eth_getUserOperationReceipt":
          assert.equal(params[0], TEST_OP_HASH)
          return {
            userOpHash: TEST_OP_HASH, sender: [...accountAddresses][0], nonce: "0x0", paymaster,
            actualGasCost: "0x1", actualGasUsed: "0x1", success: receiptSuccess, logs: [],
            receipt: { transactionHash: TEST_TX_HASH, blockNumber: "0x7b", status: "0x1", logs: [] },
          }
        default: throw new Error(`Unhandled offline RPC method: ${method}`)
      }
    } catch (error) {
      unexpected.push(error.message)
      throw error
    }
  }
  const publicClient = createPublicClient({ chain: base, transport: custom({ request }, { retryCount: 0 }), cacheTime: 0 })
  const originalFetch = globalThis.fetch
  // Intercept every fetch, including accidental real URLs. Tests in a file run serially.
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), TEST_BUNDLER_URL, "Unexpected network URL in offline test")
    const payload = JSON.parse(init.body)
    assert.equal(Array.isArray(payload), false, "Unexpected RPC batch")
    const { method, params, id } = payload
    if (method === failMethod) {
      requests.push({ method, params })
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32500, message: "Fixture rejected user operation" } }))
    }
    const result = await request({ method, params })
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }))
  }
  t.after(() => {
    globalThis.fetch = originalFetch
    assert.deepEqual(unexpected, [], "Unexpected RPC activity (including errors swallowed by viem)")
  })
  return {
    publicClient, requests, state,
    sent: () => requests.filter(({ method }) => method === "eth_sendUserOperation").map(({ params }) => params[0]),
    paymasterRequests: () => requests.filter(({ method }) => method.startsWith("pm_")),
  }
}
