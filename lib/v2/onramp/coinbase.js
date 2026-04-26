// Coinbase Onramp adapter (CDP).
// Generates a Coinbase-hosted onramp URL the human can open to convert fiat → USDC on Base.
//
// Implementation status: SHAPE-only. Actual API calls require CDP credentials (project ID + API key).
// When credentials are wired, replace the URL builder with a real CDP API call to generate
// the session URL. The contract this adapter exposes does NOT change — only the internals.
//
// CDP Onramp docs: https://docs.cdp.coinbase.com/onramp/docs/welcome

import { isAddress, getAddress } from "viem"

export const coinbaseAdapter = {
  name: "coinbase",

  // Static metadata describing what this adapter supports.
  metadata: {
    displayName: "Coinbase Pay",
    description: "Buy USDC with card or bank, powered by Coinbase. High user trust, Base-native.",
    supportedFiatCurrencies: ["USD", "EUR", "GBP", "BRL", "ARS"],
    supportedCryptoCurrencies: ["USDC"],
    supportedNetworks: ["base"],
    estimatedFeePercent: 1.0,
    geographicCoverage: "100+ countries",
    requiresKyc: true, // Coinbase handles KYC; user does it once.
  },

  // Returns { url, sessionId } — the human opens `url` in a browser.
  // After the human completes the purchase, USDC lands in `params.destinationAddress`.
  async createSession(params) {
    validateParams(params)

    const config = getCoinbaseConfig()
    if (!config.projectId) {
      // No project ID — fall back to stub URL (generic Coinbase Pay flow).
      return buildStubUrl(params)
    }

    return await buildRealSession(params, config)
  },
}

function validateParams({ destinationAddress, amount, fiat = "USD", network = "base" }) {
  if (!isAddress(destinationAddress)) {
    throw new TypeError(`destinationAddress must be a valid 0x address, got: ${destinationAddress}`)
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new TypeError(`amount must be a positive number, got: ${amount}`)
  }
  if (network !== "base") {
    throw new TypeError(`Coinbase Onramp adapter currently supports network: "base" only`)
  }
  if (!coinbaseAdapter.metadata.supportedFiatCurrencies.includes(fiat)) {
    throw new TypeError(
      `Unsupported fiat: "${fiat}". Supported: ${coinbaseAdapter.metadata.supportedFiatCurrencies.join(", ")}`,
    )
  }
}

function getCoinbaseConfig() {
  return {
    // Project ID (a.k.a. App ID) — required to bind the Onramp session to our CDP project.
    // Without it the user gets a generic Coinbase Pay flow with no Grip-branded tracking.
    projectId: process.env.COINBASE_CDP_PROJECT_ID || null,
    // API Key + Secret are used for the session-token API (gives us per-session telemetry).
    // Optional for v0.4.x — the URL builder works without them, just no per-session tracking.
    apiKeyId: process.env.COINBASE_CDP_API_KEY_ID || null,
    apiSecret: process.env.COINBASE_CDP_API_SECRET || null,
  }
}

function buildStubUrl({ destinationAddress, amount, fiat = "USD" }) {
  // No project ID configured — fall back to the generic Coinbase Pay URL.
  // Works for the human (they can complete the buy), but no project-side telemetry.
  const to = getAddress(destinationAddress)
  return {
    url: `https://pay.coinbase.com/buy/select-asset?destinationWallets=${encodeURIComponent(
      JSON.stringify([{ address: to, blockchains: ["base"], assets: ["USDC"] }]),
    )}&presetCryptoAmount=${amount}&fiatCurrency=${fiat}`,
    sessionId: `stub-${Date.now()}`,
    isStub: true,
    provider: "coinbase",
  }
}

async function buildRealSession(params, config) {
  // Project-bound URL: includes appId so the funding lands inside our CDP project's
  // dashboard with full per-session telemetry, conversion data, and funding history.
  const { destinationAddress, amount, fiat = "USD" } = params
  const to = getAddress(destinationAddress)
  const sessionId = `cb-${Date.now()}-${to.slice(2, 10)}`

  const url =
    `https://pay.coinbase.com/buy/select-asset` +
    `?appId=${encodeURIComponent(config.projectId)}` +
    `&destinationWallets=${encodeURIComponent(
      JSON.stringify([{ address: to, blockchains: ["base"], assets: ["USDC"] }]),
    )}` +
    `&presetCryptoAmount=${amount}` +
    `&fiatCurrency=${fiat}` +
    `&partnerUserId=${encodeURIComponent(sessionId)}`

  return {
    url,
    sessionId,
    isStub: false,
    provider: "coinbase",
    projectId: config.projectId,
  }
}
