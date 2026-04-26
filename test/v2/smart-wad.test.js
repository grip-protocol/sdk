import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { SmartWad } from "../../lib/v2/wad.js"
import { GripPolicyError } from "../../lib/wad.js"

const TEST_RECIPIENT = "0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A"
const OTHER_ADDRESS = "0x000000000000000000000000000000000000dEaD"

function mockSpendClient({ address = "0x2F6789008B945cc65F2B3A3F08E40fA459571dc7", transferImpl } = {}) {
  return {
    address,
    transfer:
      transferImpl ||
      (async ({ to, amount }) => ({
        opHash: "0xop",
        hash: "0xtx",
        status: "confirmed",
        basescanUrl: "https://basescan.org/tx/0xtx",
        blockNumber: "100",
        bootstrapped: null,
        paymaster: "0x6666666666667849c56f2850848cE1C4da65c68b",
      })),
  }
}

describe("SmartWad construction", () => {
  it("requires spendClient", () => {
    assert.throws(() => new SmartWad({}), /requires \{ spendClient \}/)
  })

  it("rejects negative caps", () => {
    assert.throws(
      () => new SmartWad({ spendClient: mockSpendClient(), dailyCap: -1 }),
      /dailyCap must be a non-negative number/,
    )
  })

  it("normalizes allowlist addresses", () => {
    const wad = new SmartWad({
      spendClient: mockSpendClient(),
      allowlist: [TEST_RECIPIENT],
    })
    assert.equal(wad.allowlist[0], TEST_RECIPIENT.toLowerCase())
  })

  it("uses sensible defaults", () => {
    const wad = new SmartWad({ spendClient: mockSpendClient() })
    assert.equal(wad.dailyCap, 100)
    assert.equal(wad.perTxCap, 20)
  })

  it("address comes from spendClient", () => {
    const sc = mockSpendClient({ address: "0xABC0000000000000000000000000000000000123" })
    const wad = new SmartWad({ spendClient: sc })
    assert.equal(wad.address, sc.address)
  })
})

describe("SmartWad.evaluate", () => {
  let wad
  beforeEach(() => {
    wad = new SmartWad({
      spendClient: mockSpendClient(),
      dailyCap: 25,
      perTxCap: 20,
    })
  })

  it("approves payments under both caps", () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
  })

  it("blocks payments over per-tx cap", () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 21 }).ok, false)
  })

  it("blocks payments that exceed daily cap", () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 26 }).ok, false)
  })

  it("enforces allowlist when set", () => {
    const wadAllow = new SmartWad({
      spendClient: mockSpendClient(),
      allowlist: [TEST_RECIPIENT],
      perTxCap: 20,
      dailyCap: 100,
    })
    assert.equal(wadAllow.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
    assert.equal(wadAllow.evaluate({ to: OTHER_ADDRESS, amount: 5 }).ok, false)
  })
})

describe("SmartWad.pay", () => {
  it("calls spendClient.transfer when policy allows", async () => {
    let receivedArgs
    const wad = new SmartWad({
      spendClient: mockSpendClient({
        transferImpl: async (args) => {
          receivedArgs = args
          return {
            opHash: "0xop123",
            hash: "0xtx456",
            status: "confirmed",
            basescanUrl: "https://basescan.org/tx/0xtx456",
            blockNumber: "200",
            bootstrapped: null,
            paymaster: "0x6666",
          }
        },
      }),
      dailyCap: 100,
      perTxCap: 20,
    })
    const result = await wad.pay({ to: TEST_RECIPIENT, amount: 5 })
    assert.equal(receivedArgs.to, TEST_RECIPIENT)
    assert.equal(receivedArgs.amount, 5)
    assert.equal(result.hash, "0xtx456")
    assert.equal(result.opHash, "0xop123")
    assert.equal(result.status, "confirmed")
  })

  it("throws GripPolicyError if cap exceeded, doesn't call transfer", async () => {
    let called = false
    const wad = new SmartWad({
      spendClient: mockSpendClient({
        transferImpl: async () => {
          called = true
          return {}
        },
      }),
      dailyCap: 100,
      perTxCap: 5,
    })
    await assert.rejects(
      () => wad.pay({ to: TEST_RECIPIENT, amount: 10 }),
      (err) => err instanceof GripPolicyError && /per-tx cap/.test(err.message),
    )
    assert.equal(called, false)
  })

  it("tracks spent state after successful pay", async () => {
    const wad = new SmartWad({
      spendClient: mockSpendClient(),
      dailyCap: 100,
      perTxCap: 50,
    })
    await wad.pay({ to: TEST_RECIPIENT, amount: 5 })
    await wad.pay({ to: TEST_RECIPIENT, amount: 3 })
    const s = wad.spent()
    assert.equal(s.today.used, 8)
    assert.equal(s.total, 2)
  })
})

describe("SmartWad.toJSON", () => {
  it("includes mode: smart", () => {
    const wad = new SmartWad({ spendClient: mockSpendClient() })
    assert.equal(wad.toJSON().mode, "smart")
  })
})
