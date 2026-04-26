// Helpers to make agent-driven funding flows trivial.
// The agent generates a deeplink → human taps once → wallet opens with form pre-filled.
// Then the agent calls waitForFunding() to detect arrival on-chain.

import { isAddress, getAddress, parseUnits } from "viem"
import { readUsdcBalance } from "../usdc.js"

const SUPPORTED_WALLETS = ["coinbase", "rainbow", "metamask", "raw"]

export function fundingDeeplink({ smartAccount, amount, wallet = "coinbase", token } = {}) {
  if (!smartAccount || !isAddress(smartAccount)) {
    throw new TypeError(`fundingDeeplink requires { smartAccount } as a valid 0x address`)
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new TypeError(`amount must be a positive number, got: ${amount}`)
  }
  if (!SUPPORTED_WALLETS.includes(wallet)) {
    throw new TypeError(`wallet must be one of: ${SUPPORTED_WALLETS.join(", ")}`)
  }
  if (!token || !isAddress(token)) {
    throw new TypeError(`token (USDC contract address) is required`)
  }

  const to = getAddress(smartAccount)
  const tokenAddr = getAddress(token)
  const amountRaw = parseUnits(String(amount), 6)

  switch (wallet) {
    case "coinbase":
      // Coinbase Wallet deeplink format: opens dapp browser with pre-filled ETH transfer.
      // The cb_url uses EIP-681 ethereum URI format scoped to Base mainnet (chain 8453).
      return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(
        `ethereum:${tokenAddr}@8453/transfer?address=${to}&uint256=${amountRaw.toString()}`,
      )}`
    case "rainbow":
      return `https://rnbwapp.com/send?to=${to}&token=${tokenAddr}&amount=${amount}&chain=base`
    case "metamask":
      return `https://metamask.app.link/send/${tokenAddr}@8453/transfer?address=${to}&uint256=${amountRaw.toString()}`
    case "raw":
      // Raw EIP-681 URI — works with any wallet that registers the ethereum: scheme.
      return `ethereum:${tokenAddr}@8453/transfer?address=${to}&uint256=${amountRaw.toString()}`
  }
}

export async function waitForFunding({
  address,
  network,
  minUsd,
  timeoutSeconds = 600,
  pollSeconds = 5,
  onPoll,
} = {}) {
  if (!isAddress(address)) throw new TypeError(`address must be a valid 0x address`)
  if (typeof minUsd !== "number" || minUsd <= 0) {
    throw new TypeError(`minUsd must be a positive number`)
  }

  const startTime = Date.now()
  const deadlineMs = startTime + timeoutSeconds * 1000
  let attempts = 0

  while (Date.now() < deadlineMs) {
    attempts += 1
    const balance = await readUsdcBalance({ address, network })
    if (typeof onPoll === "function") {
      onPoll({ attempt: attempts, balance: balance.usd, target: minUsd, elapsedSeconds: (Date.now() - startTime) / 1000 })
    }
    if (balance.usd >= minUsd) {
      return {
        funded: true,
        balance,
        attempts,
        elapsedSeconds: (Date.now() - startTime) / 1000,
      }
    }
    await sleep(pollSeconds * 1000)
  }

  // Timeout — return final state, don't throw. Agent decides what to do (retry, ask human, etc.)
  const finalBalance = await readUsdcBalance({ address, network })
  return {
    funded: false,
    balance: finalBalance,
    attempts,
    elapsedSeconds: (Date.now() - startTime) / 1000,
    timedOut: true,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
