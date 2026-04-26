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
    if (!config.appId) {
      // Stub mode — returns a placeholder URL pointing to Coinbase Pay's generic endpoint.
      // Real impl would POST to https://api.developer.coinbase.com/onramp/v1/sessions
      // with project credentials and return the session-specific URL.
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
    appId: process.env.COINBASE_CDP_APP_ID || null,
    apiKeyId: process.env.COINBASE_CDP_API_KEY_ID || null,
    apiSecret: process.env.COINBASE_CDP_API_SECRET || null,
  }
}

function buildStubUrl({ destinationAddress, amount, fiat = "USD" }) {
  // Stub URL: points to Coinbase Pay's generic flow without project-specific session.
  // The human will get a generic Coinbase Pay flow — works but no Grip-branded session.
  // Replace this once CDP credentials are wired.
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

async function buildRealSession(_params, _config) {
  // TODO: when CDP credentials are wired, implement the real session creation:
  //
  // const sessionRes = await fetch("https://api.developer.coinbase.com/onramp/v1/sessions", {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `Bearer ${jwtFromCdpKey(config.apiKeyId, config.apiSecret)}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     destination_wallet: { address: params.destinationAddress, network: "base" },
  //     destination_asset: "USDC",
  //     fiat_currency: params.fiat,
  //     preset_amount: params.amount,
  //   }),
  // })
  // const session = await sessionRes.json()
  // return { url: session.session_url, sessionId: session.session_id, provider: "coinbase" }
  //
  // For now, fall back to stub.
  throw new Error("Real Coinbase Onramp session not yet implemented. Awaiting CDP credentials wiring.")
}
