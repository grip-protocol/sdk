import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { createPublicClient, http } from "viem"
import { base } from "viem/chains"
import { deriveSmartAccount } from "../../lib/v2/smart-account.js"

const RPC = "https://base.llamarpc.com"

describe("deriveSmartAccount", () => {
  it("derives a smart account from an EOA private key string", async () => {
    const pk = generatePrivateKey()
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) })
    const sa = await deriveSmartAccount({ owner: pk, publicClient })
    assert.match(sa.address, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(sa.entryPoint.version, "0.6")
  })

  it("derives a smart account from a viem Account", async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) })
    const sa = await deriveSmartAccount({ owner: account, publicClient })
    assert.match(sa.address, /^0x[0-9a-fA-F]{40}$/)
  })

  it("is deterministic — same EOA derives same smart account address", async () => {
    const pk = generatePrivateKey()
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) })
    const sa1 = await deriveSmartAccount({ owner: pk, publicClient })
    const sa2 = await deriveSmartAccount({ owner: pk, publicClient })
    assert.equal(sa1.address, sa2.address)
  })

  it("different EOAs derive different smart accounts", async () => {
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) })
    const sa1 = await deriveSmartAccount({ owner: generatePrivateKey(), publicClient })
    const sa2 = await deriveSmartAccount({ owner: generatePrivateKey(), publicClient })
    assert.notEqual(sa1.address, sa2.address)
  })

  it("smart account address differs from owner EOA address", async () => {
    const pk = generatePrivateKey()
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) })
    const sa = await deriveSmartAccount({ owner: pk, publicClient })
    assert.notEqual(sa.address.toLowerCase(), privateKeyToAccount(pk).address.toLowerCase())
  })
})
