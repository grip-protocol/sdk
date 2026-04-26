import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey } from "viem/accounts"
import { init } from "../lib/client.js"

const FAKE_PIMLICO = "test_key"

describe("init() — generic", () => {
  it("rejects unsupported networks", () => {
    assert.throws(
      () => init({ account: generatePrivateKey(), network: "ethereum", mode: "eoa" }),
      /Unsupported network/,
    )
  })

  it("requires account", () => {
    assert.throws(() => init({ mode: "eoa" }), /requires \{ account \}/)
  })

  it("rejects invalid mode", () => {
    assert.throws(
      () => init({ account: generatePrivateKey(), mode: "weird" }),
      /mode must be "smart" or "eoa"/,
    )
  })
})

describe("init() — eoa mode (v0.1 compat)", () => {
  it("returns a client with an EOA address", () => {
    const client = init({ account: generatePrivateKey(), mode: "eoa" })
    assert.equal(client.mode, "eoa")
    assert.match(client.address, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(client.network, "base")
    assert.equal(client.chainId, 8453)
  })

  it("openWad returns a Wad with the client's account", () => {
    const client = init({ account: generatePrivateKey(), mode: "eoa" })
    const wad = client.openWad({ dailyCap: 50, perTxCap: 10 })
    assert.equal(wad.address, client.address)
    assert.equal(wad.dailyCap, 50)
    assert.equal(wad.perTxCap, 10)
  })

  it("uses custom RPC if provided", () => {
    const client = init({
      account: generatePrivateKey(),
      mode: "eoa",
      rpc: "https://custom-rpc.example",
    })
    assert.equal(client.network, "base")
    assert.equal(client.chainId, 8453)
  })
})

describe("init() — smart mode (v0.3 default)", () => {
  it("smart mode without any auth throws actionable error", () => {
    assert.throws(
      () => init({ account: generatePrivateKey() }),
      /needs paymaster auth/,
    )
  })

  it("smart mode with managed=true constructs a client (no key needed)", () => {
    const client = init({ account: generatePrivateKey(), managed: true })
    assert.equal(client.mode, "smart")
    assert.equal(client.network, "base")
    assert.equal(client.chainId, 8453)
    assert.match(client.eoaAddress, /^0x[0-9a-fA-F]{40}$/)
  })

  it("smart mode with explicit gripApiUrl constructs a client (BYO proxy)", () => {
    const client = init({
      account: generatePrivateKey(),
      gripApiUrl: "https://custom-proxy.example/api/v1/rpc",
    })
    assert.equal(client.mode, "smart")
  })

  it("smart mode with pimlicoApiKey constructs a client (BYOK Pimlico)", () => {
    const client = init({
      account: generatePrivateKey(),
      mode: "smart",
      pimlicoApiKey: FAKE_PIMLICO,
    })
    assert.equal(client.mode, "smart")
    assert.equal(client.network, "base")
    assert.equal(client.chainId, 8453)
    assert.match(client.eoaAddress, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(typeof client.address, "function") // lazy async
    assert.equal(typeof client.balance, "function")
    assert.equal(typeof client.openWad, "function")
    assert.equal(typeof client.state, "function")
    assert.equal(typeof client.fundingDeeplink, "function")
    assert.equal(typeof client.waitForFunding, "function")
  })

  it("smart mode reads pimlicoApiKey from env if not passed", () => {
    process.env.GRIP_PIMLICO_KEY = FAKE_PIMLICO
    try {
      const client = init({ account: generatePrivateKey(), mode: "smart" })
      assert.equal(client.mode, "smart")
    } finally {
      delete process.env.GRIP_PIMLICO_KEY
    }
  })
})
