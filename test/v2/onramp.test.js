import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { getAdapter, listProviders, registerAdapter } from "../../lib/v2/onramp/index.js"

const TEST_ADDRESS = "0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A"

describe("onramp adapter registry", () => {
  it("ships with coinbase + crossmint + mock", () => {
    const providers = listProviders()
    assert.ok(providers.includes("coinbase"))
    assert.ok(providers.includes("crossmint"))
    // mock is excluded from listProviders (test-only)
    assert.equal(providers.includes("mock"), false)
  })

  it("getAdapter returns named adapter", () => {
    const cb = getAdapter("coinbase")
    assert.equal(cb.name, "coinbase")
    assert.equal(typeof cb.createSession, "function")
    assert.equal(typeof cb.metadata, "object")
  })

  it("getAdapter throws on unknown provider with actionable message", () => {
    assert.throws(
      () => getAdapter("unknown-provider"),
      /Unknown onramp provider.*Available.*ONRAMP_INTEGRATION/s,
    )
  })

  it("registerAdapter adds runtime adapter", () => {
    registerAdapter("custom-test", { name: "custom-test", metadata: {}, createSession: async () => ({}) })
    const adapter = getAdapter("custom-test")
    assert.equal(adapter.name, "custom-test")
  })
})

describe("OnrampAdapter contract — coinbase", () => {
  it("createSession returns { url, sessionId, provider } shape", async () => {
    const adapter = getAdapter("coinbase")
    const session = await adapter.createSession({
      destinationAddress: TEST_ADDRESS,
      amount: 25,
      fiat: "USD",
      network: "base",
    })
    assert.equal(typeof session.url, "string")
    assert.match(session.url, /^https:\/\//)
    assert.equal(typeof session.sessionId, "string")
    assert.equal(session.provider, "coinbase")
  })

  it("rejects invalid destinationAddress", async () => {
    const adapter = getAdapter("coinbase")
    await assert.rejects(
      () => adapter.createSession({ destinationAddress: "not-an-address", amount: 25 }),
      /valid 0x address/,
    )
  })

  it("rejects negative amount", async () => {
    const adapter = getAdapter("coinbase")
    await assert.rejects(
      () => adapter.createSession({ destinationAddress: TEST_ADDRESS, amount: -1 }),
      /positive number/,
    )
  })

  it("rejects unsupported network", async () => {
    const adapter = getAdapter("coinbase")
    await assert.rejects(
      () => adapter.createSession({ destinationAddress: TEST_ADDRESS, amount: 25, network: "ethereum" }),
      /supports network: "base" only/,
    )
  })

  it("rejects unsupported fiat", async () => {
    const adapter = getAdapter("coinbase")
    await assert.rejects(
      () => adapter.createSession({ destinationAddress: TEST_ADDRESS, amount: 25, fiat: "ZWL" }),
      /Unsupported fiat/,
    )
  })

  it("metadata describes provider correctly", () => {
    const m = getAdapter("coinbase").metadata
    assert.equal(typeof m.displayName, "string")
    assert.ok(m.supportedFiatCurrencies.includes("USD"))
    assert.ok(m.supportedCryptoCurrencies.includes("USDC"))
    assert.ok(m.supportedNetworks.includes("base"))
  })
})

describe("OnrampAdapter contract — crossmint", () => {
  it("createSession returns shape", async () => {
    const adapter = getAdapter("crossmint")
    const session = await adapter.createSession({
      destinationAddress: TEST_ADDRESS,
      amount: 10,
      fiat: "USD",
    })
    assert.equal(typeof session.url, "string")
    assert.equal(session.provider, "crossmint")
  })
})

describe("OnrampAdapter contract — mock (testing)", () => {
  it("returns deterministic synthetic session", async () => {
    const adapter = getAdapter("mock")
    const a = await adapter.createSession({ destinationAddress: TEST_ADDRESS, amount: 5 })
    const b = await adapter.createSession({ destinationAddress: TEST_ADDRESS, amount: 5 })
    assert.equal(a.sessionId, b.sessionId) // deterministic
    assert.equal(a.isMock, true)
  })
})
