import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { privateKeyToAccount } from "viem/accounts"
import { deriveSmartAccount, getSmartAccountState } from "../../lib/v2/smart-account.js"
import { PIMLICO_PAYMASTER_V06_BASE } from "../../lib/v2/constants.js"
import { createOfflineRpc, TEST_NETWORK, TEST_OWNER } from "../helpers/offline-rpc.js"

describe("deriveSmartAccount with an offline factory fixture", () => {
  it("derives a smart account from an EOA private key string", async (t) => {
    const pk = TEST_OWNER
    const { publicClient } = createOfflineRpc(t)
    const sa = await deriveSmartAccount({ owner: pk, publicClient })
    assert.match(sa.address, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(sa.entryPoint.version, "0.6")
  })

  it("derives a smart account from a viem Account", async (t) => {
    const account = privateKeyToAccount(TEST_OWNER)
    const { publicClient } = createOfflineRpc(t)
    const sa = await deriveSmartAccount({ owner: account, publicClient })
    assert.match(sa.address, /^0x[0-9a-fA-F]{40}$/)
  })

  it("passes the same factory inputs for the same EOA", async (t) => {
    const pk = TEST_OWNER
    const { publicClient } = createOfflineRpc(t)
    const sa1 = await deriveSmartAccount({ owner: pk, publicClient })
    const sa2 = await deriveSmartAccount({ owner: pk, publicClient })
    assert.equal(sa1.address, sa2.address)
  })

  it("passes distinct factory inputs for different EOAs", async (t) => {
    const { publicClient } = createOfflineRpc(t)
    const sa1 = await deriveSmartAccount({ owner: TEST_OWNER, publicClient })
    const sa2 = await deriveSmartAccount({ owner: `0x${"22".repeat(32)}`, publicClient })
    assert.notEqual(sa1.address, sa2.address)
  })

  it("uses the factory response as address, not the owner address", async (t) => {
    const pk = TEST_OWNER
    const { publicClient } = createOfflineRpc(t)
    const sa = await deriveSmartAccount({ owner: pk, publicClient })
    assert.notEqual(sa.address.toLowerCase(), privateKeyToAccount(pk).address.toLowerCase())
  })
})

describe("getSmartAccountState allowance readiness", () => {
  for (const { allowance, deployed, ready } of [
    { allowance: 500_001n, deployed: true, ready: true },
    { allowance: 500_000n, deployed: true, ready: true },
    { allowance: 499_999n, deployed: true, ready: false },
    { allowance: 1n, deployed: true, ready: false },
    { allowance: 0n, deployed: true, ready: false },
    { allowance: 2_000_000n, deployed: false, ready: false },
    { allowance: 0n, deployed: false, ready: false },
  ]) {
    it(`allowance ${allowance}, deployed ${deployed}: ready ${ready}`, async (t) => {
      const { publicClient } = createOfflineRpc(t, { allowance, deployed, ethBalance: 123n, usdcBalance: 4_000_000n })
      const smartAccount = await deriveSmartAccount({ owner: TEST_OWNER, publicClient })
      const state = await getSmartAccountState({
        smartAccount, publicClient, network: TEST_NETWORK, paymasterAddress: PIMLICO_PAYMASTER_V06_BASE,
      })
      assert.deepEqual(state, {
        address: smartAccount.address, deployed, ethBalance: 123n, usdcBalance: 4_000_000n,
        paymasterAllowance: allowance, bootstrapped: ready,
      })
    })
  }
})
