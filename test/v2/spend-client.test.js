import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decodeFunctionData, concat, maxUint256 } from "viem"
import {
  allowanceRefillFloor,
  assertApproveAmountWithinBudget,
  assertPositiveApproveAmount,
  createSpendClient,
} from "../../lib/v2/spend-client.js"
import { PIMLICO_PAYMASTER_V06_BASE } from "../../lib/v2/constants.js"
import {
  createOfflineRpc, TEST_OWNER, TEST_NETWORK, TEST_BUNDLER_URL,
  TEST_RECIPIENT, TEST_TX_HASH, TEST_OP_HASH, TOKEN_ABI,
} from "../helpers/offline-rpc.js"

async function setup(t, fixtureOptions = {}, clientOptions = {}) {
  const rpc = createOfflineRpc(t, fixtureOptions)
  const client = await createSpendClient({
    owner: TEST_OWNER, publicClient: rpc.publicClient, network: TEST_NETWORK,
    gripApiUrl: TEST_BUNDLER_URL, ...clientOptions,
  })
  return { rpc, client }
}

function assertPaymasterMode(rpc, sponsored) {
  const requests = rpc.paymasterRequests()
  assert.ok(requests.length > 0, "Expected real viem paymaster RPC requests")
  assert.deepEqual(requests.map(({ method }) => method), ["pm_getPaymasterStubData", "pm_getPaymasterData"])
  for (const { params } of requests) {
    assert.deepEqual(params[3], sponsored ? null : { token: TEST_NETWORK.usdc })
  }
}

async function assertCalls(client, rpc, { approve, transfer = true, amount = 1_000_000n, to = TEST_RECIPIENT, approveAmount = 2_000_000n }) {
  assert.equal(rpc.sent().length, 1, "Exactly one UserOp must contain the complete action")
  const calls = await client.smartAccount.decodeCalls(rpc.sent()[0].callData)
  assert.equal(calls.length, Number(approve) + Number(transfer))
  for (const call of calls) {
    assert.equal(call.to.toLowerCase(), TEST_NETWORK.usdc.toLowerCase())
    assert.equal(call.value, 0n)
  }
  const decoded = calls.map(({ data }) => decodeFunctionData({ abi: TOKEN_ABI, data }))
  if (approve) {
    assert.equal(decoded[0].functionName, "approve")
    assert.equal(decoded[0].args[0].toLowerCase(), PIMLICO_PAYMASTER_V06_BASE.toLowerCase())
    assert.equal(decoded[0].args[1], approveAmount, "Approval must encode this exact finite amount")
  }
  if (transfer) {
    const last = decoded.at(-1)
    assert.equal(last.functionName, "transfer")
    assert.equal(last.args[0].toLowerCase(), to.toLowerCase())
    assert.equal(last.args[1], amount)
  }
  return calls
}

const allowanceCases = [
  { name: "above threshold", allowance: 500_001n, deployed: true, approve: false, sponsored: false },
  { name: "exact threshold", allowance: 500_000n, deployed: true, approve: false, sponsored: false },
  { name: "legacy unlimited allowance", allowance: maxUint256, deployed: true, approve: false, sponsored: false },
  { name: "just below threshold", allowance: 499_999n, deployed: true, approve: true, sponsored: false },
  { name: "one raw unit left", allowance: 1n, deployed: true, approve: true, sponsored: false },
  { name: "zero allowance", allowance: 0n, deployed: true, approve: true, sponsored: true },
  { name: "undeployed with zero allowance", allowance: 0n, deployed: false, approve: true, sponsored: true },
  { name: "undeployed with positive allowance", allowance: 500_001n, deployed: false, approve: true, sponsored: true },
]

describe("transfer finite paymaster allowance, offline viem pipeline", () => {
  for (const scenario of allowanceCases) {
    it(scenario.name, async (t) => {
      const { client, rpc } = await setup(t, scenario)
      const result = await client.transfer({ to: TEST_RECIPIENT, amount: 1 })
      await assertCalls(client, rpc, scenario)
      assertPaymasterMode(rpc, scenario.sponsored)
      assert.equal(rpc.sent()[0].initCode === "0x", scenario.deployed)
      assert.equal(result.status, "confirmed")
      assert.equal(result.hash, TEST_TX_HASH)
      assert.equal(result.opHash, TEST_OP_HASH)
      assert.equal(result.blockNumber, "123")
      assert.equal(result.bootstrapped, scenario.sponsored ? TEST_TX_HASH : null)
    })
  }
})

describe("ensureBootstrapped finite approval", () => {
  for (const scenario of allowanceCases) {
    it(scenario.name, async (t) => {
      const { client, rpc } = await setup(t, scenario)
      const result = await client.ensureBootstrapped()
      assert.equal(result.alreadyDone, !scenario.approve)
      if (scenario.approve) {
        await assertCalls(client, rpc, { approve: true, transfer: false })
        assertPaymasterMode(rpc, scenario.sponsored)
        assert.equal(result.success, true)
      } else {
        assert.equal(rpc.sent().length, 0)
        assert.equal(rpc.paymasterRequests().length, 0)
        assert.equal(result.paymasterAllowance, scenario.allowance)
      }
    })
  }
})

describe("identity on atomic allowance refill", () => {
  for (const { name, identity, expected } of [
    { name: "client default", identity: undefined, expected: "0xaabbccdd" },
    { name: "per-transfer override", identity: "0x123456", expected: "0x123456" },
    { name: "explicit null disables", identity: null, expected: null },
  ]) {
    it(name, async (t) => {
      const { client, rpc } = await setup(t, { allowance: 499_999n }, { gripIdentity: "0xaabbccdd" })
      const result = await client.transfer({ to: TEST_RECIPIENT, amount: 1, identity })
      const calls = await assertCalls(client, rpc, { approve: true })
      const encodedCalls = await client.smartAccount.encodeCalls(calls)
      assert.equal(rpc.sent()[0].callData, expected ? concat([encodedCalls, expected]) : encodedCalls)
      assert.equal(result.identity, expected)
      assertPaymasterMode(rpc, false)
    })
  }
})

describe("funding and failure behavior", () => {
  for (const allowance of [0n, 1n, 500_000n]) {
    it(`rejects amount exceeding balance at allowance ${allowance}`, async (t) => {
      const { client, rpc } = await setup(t, { allowance, usdcBalance: 999_999n })
      await assert.rejects(client.transfer({ to: TEST_RECIPIENT, amount: 1 }), /Insufficient USDC/)
      assert.equal(rpc.sent().length, 0)
      assert.equal(rpc.paymasterRequests().length, 0)
    })
  }
  for (const allowance of [1n, 500_000n]) {
    it(`rejects spending full balance in ERC20 mode at allowance ${allowance}`, async (t) => {
      const { client, rpc } = await setup(t, { allowance, usdcBalance: 1_000_000n })
      await assert.rejects(client.transfer({ to: TEST_RECIPIENT, amount: 1 }), /Insufficient USDC/)
      assert.equal(rpc.sent().length, 0)
      assert.equal(rpc.paymasterRequests().length, 0)
    })
  }
  it("allows an exact-balance self-transfer because USDC stays in the account", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 1n, usdcBalance: 1_000_000n })
    await client.transfer({ to: client.address, amount: 1 })
    await assertCalls(client, rpc, { approve: true, to: client.address })
    assertPaymasterMode(rpc, false)
  })
  it("allows sponsored bootstrap to transfer the full balance", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 0n, usdcBalance: 1_000_000n })
    await client.transfer({ to: TEST_RECIPIENT, amount: 1 })
    await assertCalls(client, rpc, { approve: true })
    assertPaymasterMode(rpc, true)
  })
  it("rejects standalone ERC20 refill without USDC, without falling back to sponsorship", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 1n, usdcBalance: 0n })
    await assert.rejects(client.ensureBootstrapped(), /Insufficient USDC/)
    assert.equal(rpc.sent().length, 0)
    assert.equal(rpc.paymasterRequests().length, 0)
  })
  it("permits sponsored zero-balance standalone bootstrap", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 0n, usdcBalance: 0n })
    await client.ensureBootstrapped()
    await assertCalls(client, rpc, { approve: true, transfer: false })
    assertPaymasterMode(rpc, true)
  })
  for (const method of ["transfer", "ensureBootstrapped"]) {
    it(`${method} preserves a failed receipt without sponsor retry`, async (t) => {
      const { client, rpc } = await setup(t, { allowance: 1n, receiptSuccess: false })
      const result = method === "transfer"
        ? await client.transfer({ to: TEST_RECIPIENT, amount: 1 })
        : await client.ensureBootstrapped()
      assert.equal(method === "transfer" ? result.status : result.success, method === "transfer" ? "failed" : false)
      assert.equal(rpc.sent().length, 1)
      assertPaymasterMode(rpc, false)
    })
    for (const failMethod of ["eth_estimateUserOperationGas", "eth_sendUserOperation"]) {
      it(`${method} propagates ${failMethod} rejection without sponsor retry`, async (t) => {
        const { client, rpc } = await setup(t, { allowance: 1n, failMethod })
        const pending = method === "transfer"
          ? client.transfer({ to: TEST_RECIPIENT, amount: 1 })
          : client.ensureBootstrapped()
        await assert.rejects(pending, /Fixture rejected user operation/)
        assert.equal(rpc.sent().length, failMethod === "eth_sendUserOperation" ? 1 : 0)
        assert.ok(rpc.paymasterRequests().length > 0)
        for (const { params } of rpc.paymasterRequests()) assert.deepEqual(params[3], { token: TEST_NETWORK.usdc })
        assert.equal(rpc.requests.filter(({ method }) => method === "eth_getUserOperationReceipt").length, 0)
      })
    }
  }
})

describe("explicit approve lowers a legacy allowance", () => {
  it("allowance maxUint produces approve(2.00) and does not short-circuit", async (t) => {
    const { client, rpc } = await setup(t, { allowance: maxUint256, deployed: true })
    const skipped = await client.ensureBootstrapped()
    assert.equal(skipped.alreadyDone, true, "ensureBootstrapped still short-circuits above the floor")
    assert.equal(rpc.sent().length, 0)
    const result = await client.approvePaymaster()
    assert.equal(result.alreadyDone, false)
    assert.equal(result.success, true)
    await assertCalls(client, rpc, { approve: true, transfer: false })
    assertPaymasterMode(rpc, false)
  })

  it("rejects approve amount 0 before building the UserOp", async (t) => {
    const { client, rpc } = await setup(t, { allowance: maxUint256, deployed: true })
    await assert.rejects(
      client.approvePaymaster(0n),
      /approve amount must be a positive raw USDC amount/,
    )
    assert.equal(rpc.sent().length, 0)
    assert.equal(rpc.paymasterRequests().length, 0)
    assert.throws(() => assertPositiveApproveAmount(0n), /positive raw USDC amount/)
  })

  it("refills when allowance clears the threshold but not the quote", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 500_001n, deployed: true })
    assert.equal(allowanceRefillFloor(600_000n), 600_000n)
    await client.transfer({ to: TEST_RECIPIENT, amount: 1, quoteMinor: 600_000n })
    await assertCalls(client, rpc, { approve: true })
    assertPaymasterMode(rpc, false)
  })

  it("succeeds with transfer only when allowance covers threshold and quote", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 2_000_000n, deployed: true })
    const result = await client.transfer({ to: TEST_RECIPIENT, amount: 1, quoteMinor: 3_700n })
    await assertCalls(client, rpc, { approve: false })
    assert.equal(result.status, "confirmed")
    assertPaymasterMode(rpc, false)
  })

  it("preserves a reverted explicit approve without a second send", async (t) => {
    const { client, rpc } = await setup(t, { allowance: maxUint256, receiptSuccess: false })
    const result = await client.approvePaymaster()
    assert.equal(result.success, false)
    assert.equal(rpc.sent().length, 1)
    assert.equal(rpc.paymasterRequests().length, 2)
  })

  for (const { name, amount } of [
    { name: "one raw unit above the budget", amount: 2_000_001n },
    { name: "maxUint", amount: maxUint256 },
  ]) {
    it(`rejects approve(${name}) before building the UserOp`, async (t) => {
      const { client, rpc } = await setup(t, { allowance: 2_000_000n, deployed: true })
      await assert.rejects(
        client.approvePaymaster(amount),
        /exceeds the 2\.00 USDC budget/,
      )
      assert.equal(rpc.sent().length, 0)
      assert.equal(rpc.paymasterRequests().length, 0)
      assert.throws(() => assertApproveAmountWithinBudget(amount), /exceeds the 2\.00 USDC budget/)
    })
  }

  it("encodes a non-default in-range approve amount exactly", async (t) => {
    const amount = 1_250_000n
    const { client, rpc } = await setup(t, { allowance: maxUint256, deployed: true })
    const result = await client.approvePaymaster(amount)
    assert.equal(result.alreadyDone, false)
    assert.notEqual(amount, 2_000_000n)
    await assertCalls(client, rpc, { approve: true, transfer: false, approveAmount: amount })
    assertPaymasterMode(rpc, false)
  })

  for (const { name, allowance } of [
    { name: "below the refill threshold", allowance: 499_999n },
    { name: "already at the budget", allowance: 2_000_000n },
    { name: "legacy maxUint", allowance: maxUint256 },
  ]) {
    it(`rejects a quote above 2.00 before send when allowance is ${name}`, async (t) => {
      const { client, rpc } = await setup(t, { allowance, deployed: true })
      await assert.rejects(
        client.transfer({ to: TEST_RECIPIENT, amount: 1, quoteMinor: 2_000_001n }),
        /exceeds the 2\.00 USDC allowance budget/,
      )
      assert.equal(rpc.sent().length, 0)
      assert.equal(rpc.paymasterRequests().length, 0)
    })
  }

  it("quote equal to 2.00 still refills and sends approve(2.00)", async (t) => {
    const { client, rpc } = await setup(t, { allowance: 499_999n, deployed: true })
    await client.transfer({ to: TEST_RECIPIENT, amount: 1, quoteMinor: 2_000_000n })
    await assertCalls(client, rpc, { approve: true })
    assertPaymasterMode(rpc, false)
  })

  it("post-charge allowance above the floor sends transfer only", async (t) => {
    // 2.00 approved, then postOp took 3700 raw. 1_996_300 still clears the floor and the next quote.
    const charged = 2_000_000n - 3_700n
    const { client, rpc } = await setup(t, { allowance: charged, deployed: true })
    await client.transfer({ to: TEST_RECIPIENT, amount: 1, quoteMinor: 3_700n })
    await assertCalls(client, rpc, { approve: false })
    assertPaymasterMode(rpc, false)
  })
})
