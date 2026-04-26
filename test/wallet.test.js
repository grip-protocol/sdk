import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { adaptAccount } from "../lib/wallet.js"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

describe("adaptAccount", () => {
  it("accepts a hex private key string", () => {
    const pk = generatePrivateKey()
    const acc = adaptAccount(pk)
    assert.equal(typeof acc.address, "string")
    assert.match(acc.address, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(typeof acc.signMessage, "function")
  })

  it("accepts an existing viem Account", () => {
    const pk = generatePrivateKey()
    const original = privateKeyToAccount(pk)
    const adapted = adaptAccount(original)
    assert.equal(adapted.address, original.address)
  })

  it("rejects non-hex strings", () => {
    assert.throws(() => adaptAccount("not-a-key"), /hex private key/)
  })

  it("rejects hex of wrong length", () => {
    assert.throws(() => adaptAccount("0x1234"), /32-byte hex/)
  })

  it("rejects null/undefined", () => {
    assert.throws(() => adaptAccount(null), /requires \{ account \}/)
    assert.throws(() => adaptAccount(undefined), /requires \{ account \}/)
  })

  it("rejects plain objects without signMessage", () => {
    assert.throws(() => adaptAccount({ address: "0xabc" }), /hex private key string or a viem Account/)
  })
})
