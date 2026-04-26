import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { Wad, GripPolicyError, parseExpiry } from "../lib/wad.js"
import { NETWORKS } from "../lib/contracts.js"

const TEST_RECIPIENT = "0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A"
const OTHER_ADDRESS = "0x000000000000000000000000000000000000dEaD"

function freshAccount() {
  return privateKeyToAccount(generatePrivateKey())
}

function freshNetwork() {
  return {
    chainId: NETWORKS.base.chainId,
    name: NETWORKS.base.name,
    rpc: NETWORKS.base.defaultRpc,
    explorer: NETWORKS.base.explorer,
    usdc: NETWORKS.base.usdc,
    grip: NETWORKS.base.grip,
  }
}

describe("Wad construction", () => {
  it("requires account and network", () => {
    assert.throws(() => new Wad({}), /requires \{ account \}/)
    assert.throws(() => new Wad({ account: freshAccount() }), /requires \{ network \}/)
  })

  it("rejects negative caps", () => {
    assert.throws(
      () => new Wad({ account: freshAccount(), network: freshNetwork(), dailyCap: -1 }),
      /dailyCap must be a non-negative number/,
    )
    assert.throws(
      () => new Wad({ account: freshAccount(), network: freshNetwork(), perTxCap: -5 }),
      /perTxCap must be a non-negative number/,
    )
  })

  it("rejects allowlist with invalid addresses", () => {
    assert.throws(
      () => new Wad({ account: freshAccount(), network: freshNetwork(), allowlist: ["not-an-address"] }),
      /allowlist contains invalid address/,
    )
  })

  it("normalizes allowlist addresses to lowercase", () => {
    const wad = new Wad({
      account: freshAccount(),
      network: freshNetwork(),
      allowlist: [TEST_RECIPIENT],
    })
    assert.equal(wad.allowlist[0], TEST_RECIPIENT.toLowerCase())
  })

  it("uses sensible defaults", () => {
    const wad = new Wad({ account: freshAccount(), network: freshNetwork() })
    assert.equal(wad.dailyCap, 100)
    assert.equal(wad.perTxCap, 20)
    assert.deepEqual(wad.allowlist, [])
    assert.equal(wad.expiresAt, null)
  })
})

describe("Wad.evaluate", () => {
  let wad

  beforeEach(() => {
    wad = new Wad({
      account: freshAccount(),
      network: freshNetwork(),
      dailyCap: 25,
      perTxCap: 20,
    })
  })

  it("approves payments under both caps", () => {
    const r = wad.evaluate({ to: TEST_RECIPIENT, amount: 5 })
    assert.equal(r.ok, true)
    assert.deepEqual(r.reasons, [])
  })

  it("blocks payments over per-tx cap", () => {
    const r = wad.evaluate({ to: TEST_RECIPIENT, amount: 21 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(", "), /exceeds per-tx cap/)
  })

  it("blocks payments that would exceed daily cap", () => {
    const r = wad.evaluate({ to: TEST_RECIPIENT, amount: 26 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(", "), /exceeds (per-tx|daily) cap/)
  })

  it("treats exact-equal-to-cap as allowed (boundary)", () => {
    const r = wad.evaluate({ to: TEST_RECIPIENT, amount: 20 })
    assert.equal(r.ok, true)
  })

  it("rejects invalid recipient address", () => {
    const r = wad.evaluate({ to: "0xnotanaddress", amount: 5 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(", "), /invalid recipient/)
  })

  it("rejects zero or negative amounts", () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 0 }).ok, false)
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: -1 }).ok, false)
  })

  it("enforces allowlist when set", () => {
    const wadAllow = new Wad({
      account: freshAccount(),
      network: freshNetwork(),
      allowlist: [TEST_RECIPIENT],
      perTxCap: 20,
      dailyCap: 100,
    })
    assert.equal(wadAllow.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
    const blocked = wadAllow.evaluate({ to: OTHER_ADDRESS, amount: 5 })
    assert.equal(blocked.ok, false)
    assert.match(blocked.reasons.join(", "), /not on allowlist/)
  })

  it("ignores allowlist when empty (open mode)", () => {
    const wadOpen = new Wad({ account: freshAccount(), network: freshNetwork(), allowlist: [] })
    assert.equal(wadOpen.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
    assert.equal(wadOpen.evaluate({ to: OTHER_ADDRESS, amount: 5 }).ok, true)
  })

  it("blocks all payments when wad is expired", () => {
    const expiredWad = new Wad({
      account: freshAccount(),
      network: freshNetwork(),
      expiresIn: new Date(Date.now() - 1000),
    })
    const r = expiredWad.evaluate({ to: TEST_RECIPIENT, amount: 1 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(", "), /expired/)
  })

  it("blocks everything when dailyCap is zero", () => {
    const zeroWad = new Wad({ account: freshAccount(), network: freshNetwork(), dailyCap: 0 })
    assert.equal(zeroWad.evaluate({ to: TEST_RECIPIENT, amount: 1 }).ok, false)
  })
})

describe("Wad.spent", () => {
  it("starts at zero", () => {
    const wad = new Wad({ account: freshAccount(), network: freshNetwork() })
    const s = wad.spent()
    assert.equal(s.today.used, 0)
    assert.equal(s.today.cap, 100)
    assert.equal(s.today.remaining, 100)
    assert.equal(s.total, 0)
    assert.equal(s.lastTx, null)
  })
})

describe("parseExpiry", () => {
  it("returns null for null/undefined", () => {
    assert.equal(parseExpiry(null), null)
    assert.equal(parseExpiry(undefined), null)
  })

  it("passes Date through", () => {
    const d = new Date()
    assert.equal(parseExpiry(d), d)
  })

  it("parses days", () => {
    const before = Date.now()
    const result = parseExpiry("30d")
    assert.ok(result instanceof Date)
    const delta = result.getTime() - before
    assert.ok(delta >= 30 * 86400e3 - 1000 && delta <= 30 * 86400e3 + 1000)
  })

  it("parses hours", () => {
    const result = parseExpiry("12h")
    assert.ok(result instanceof Date)
  })

  it("parses minutes", () => {
    const result = parseExpiry("30m")
    assert.ok(result instanceof Date)
  })

  it("rejects bad formats", () => {
    assert.throws(() => parseExpiry("30s"), /Invalid expiresIn/)
    assert.throws(() => parseExpiry("forever"), /Invalid expiresIn/)
    assert.throws(() => parseExpiry("d30"), /Invalid expiresIn/)
  })
})

describe("GripPolicyError", () => {
  it("carries reasons array", () => {
    const err = new GripPolicyError("blocked", ["reason a", "reason b"])
    assert.equal(err.name, "GripPolicyError")
    assert.deepEqual(err.reasons, ["reason a", "reason b"])
  })
})
