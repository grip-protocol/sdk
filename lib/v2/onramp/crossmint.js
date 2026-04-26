// Crossmint adapter — fiat → USDC checkout flow built on Crossmint's hosted widget.
//
// Implementation status: SHAPE-only. Actual API calls require CROSSMINT_API_KEY env var
// (server-side `sk_*` key from https://www.crossmint.com).
//
// Crossmint docs: https://docs.crossmint.com/payments/headless/quickstart

import { isAddress, getAddress } from "viem"

export const crossmintAdapter = {
  name: "crossmint",

  metadata: {
    displayName: "Crossmint",
    description: "Buy USDC with card, Apple Pay, or Google Pay. Dev-friendly checkout.",
    supportedFiatCurrencies: ["USD", "EUR", "GBP"],
    supportedCryptoCurrencies: ["USDC"],
    supportedNetworks: ["base"],
    estimatedFeePercent: 3.5,
    geographicCoverage: "100+ countries",
    requiresKyc: true, // Crossmint handles KYC inline.
  },

  async createSession(params) {
    validateParams(params)

    const config = getCrossmintConfig()
    if (!config.apiKey) {
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
    throw new TypeError(`Crossmint adapter currently supports network: "base" only`)
  }
  if (!crossmintAdapter.metadata.supportedFiatCurrencies.includes(fiat)) {
    throw new TypeError(
      `Unsupported fiat: "${fiat}". Supported: ${crossmintAdapter.metadata.supportedFiatCurrencies.join(", ")}`,
    )
  }
}

function getCrossmintConfig() {
  return {
    apiKey: process.env.CROSSMINT_API_KEY || null, // sk_xxx server-side key
    env: process.env.CROSSMINT_ENV || "production", // "staging" or "production"
  }
}

function buildStubUrl({ destinationAddress, amount, fiat = "USD" }) {
  // Stub: generic Crossmint hosted checkout placeholder.
  // Real impl creates an order via API and returns the checkout URL.
  const to = getAddress(destinationAddress)
  return {
    url: `https://www.crossmint.com/checkout?recipient=${to}&chain=base&token=USDC&amount=${amount}&currency=${fiat}`,
    sessionId: `stub-${Date.now()}`,
    isStub: true,
    provider: "crossmint",
  }
}

async function buildRealSession(_params, _config) {
  // TODO: implement real Crossmint order creation when API key is wired:
  //
  // const env = config.env === "staging" ? "staging" : "www"
  // const orderRes = await fetch(`https://${env}.crossmint.com/api/2022-06-09/orders`, {
  //   method: "POST",
  //   headers: { "X-API-KEY": config.apiKey, "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     payment: {
  //       method: "stripe-payment-element",
  //       currency: params.fiat.toLowerCase(),
  //     },
  //     lineItems: [{
  //       tokenLocator: `base:USDC:${params.amount}`,
  //       executionParameters: { recipient: { walletAddress: params.destinationAddress } },
  //     }],
  //   }),
  // })
  // const order = await orderRes.json()
  // return { url: order.payment.preparation.stripeClientSecret, sessionId: order.orderId, provider: "crossmint" }
  //
  throw new Error("Real Crossmint session not yet implemented. Awaiting API key wiring.")
}
