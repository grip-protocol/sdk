import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { fundingDeeplink } from "../../lib/v2/funding.js"

const SMART_ACCOUNT = "0x8Ff345B3bd3570cD92b9c42B3f272b47302B8067"
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

describe("fundingDeeplink", () => {
  it("generates a Coinbase Wallet deeplink with proper URL encoding", () => {
    const link = fundingDeeplink({
      smartAccount: SMART_ACCOUNT,
      amount: 5,
      wallet: "coinbase",
      token: USDC,
    })
    assert.match(link, /^https:\/\/go\.cb-w\.com\/dapp\?cb_url=/)
    assert.match(link, /ethereum/)
    assert.match(link, /8453/)
    assert.match(link, /5000000/) // 5 USDC raw (6 decimals)
  })

  it("generates a Rainbow deeplink", () => {
    const link = fundingDeeplink({
      smartAccount: SMART_ACCOUNT,
      amount: 5,
      wallet: "rainbow",
      token: USDC,
    })
    assert.match(link, /^https:\/\/rnbwapp\.com\/send/)
    assert.match(link, new RegExp(`to=${SMART_ACCOUNT}`))
  })

  it("generates a MetaMask deeplink", () => {
    const link = fundingDeeplink({
      smartAccount: SMART_ACCOUNT,
      amount: 5,
      wallet: "metamask",
      token: USDC,
    })
    assert.match(link, /^https:\/\/metamask\.app\.link\/send/)
    assert.match(link, /5000000/)
  })

  it("generates a raw EIP-681 URI", () => {
    const link = fundingDeeplink({
      smartAccount: SMART_ACCOUNT,
      amount: 5,
      wallet: "raw",
      token: USDC,
    })
    assert.match(link, /^ethereum:/)
    assert.match(link, /@8453/)
  })

  it("encodes amount with 6 decimals correctly", () => {
    const link = fundingDeeplink({
      smartAccount: SMART_ACCOUNT,
      amount: 0.5,
      wallet: "raw",
      token: USDC,
    })
    assert.match(link, /500000/) // 0.5 * 10^6
  })

  it("rejects invalid wallet name", () => {
    assert.throws(
      () => fundingDeeplink({
        smartAccount: SMART_ACCOUNT,
        amount: 5,
        wallet: "phantom",
        token: USDC,
      }),
      /wallet must be one of/,
    )
  })

  it("rejects invalid smartAccount address", () => {
    assert.throws(
      () => fundingDeeplink({
        smartAccount: "not-an-address",
        amount: 5,
        wallet: "coinbase",
        token: USDC,
      }),
      /valid 0x address/,
    )
  })

  it("rejects negative or zero amount", () => {
    assert.throws(
      () => fundingDeeplink({
        smartAccount: SMART_ACCOUNT,
        amount: 0,
        wallet: "coinbase",
        token: USDC,
      }),
      /positive number/,
    )
    assert.throws(
      () => fundingDeeplink({
        smartAccount: SMART_ACCOUNT,
        amount: -1,
        wallet: "coinbase",
        token: USDC,
      }),
      /positive number/,
    )
  })

  it("rejects missing token", () => {
    assert.throws(
      () => fundingDeeplink({
        smartAccount: SMART_ACCOUNT,
        amount: 5,
        wallet: "coinbase",
      }),
      /token .* required/,
    )
  })
})
