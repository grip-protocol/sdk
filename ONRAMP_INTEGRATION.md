# Onramp integration guide

Welcome. This document is for fiat onramp providers (Coinbase Pay, Crossmint, MoonPay, Ramp, Transak, Sardine, etc.) who want to integrate with `@grip-labs/sdk`.

When a Grip-powered agent needs to fund itself, it asks its human to send USDC. The agent generates a one-tap link or hosted checkout via an **onramp adapter**. Each adapter is a self-contained module implementing a small interface.

A complete integration takes ~1 day of engineering and ships behind `client.onramp({ provider: 'your-name' })` so any agent using Grip can route to your service.

## What you ship

A single JS file (~100 lines) implementing the `OnrampAdapter` interface, plus tests.

```js
// lib/v2/onramp/your-name.js
import { isAddress } from "viem"

export const yourNameAdapter = {
  name: "your-name",

  metadata: {
    displayName: "Your Brand",
    description: "One-line pitch shown to agents/devs choosing a provider",
    supportedFiatCurrencies: ["USD", "EUR", "GBP"],
    supportedCryptoCurrencies: ["USDC"],
    supportedNetworks: ["base"],
    estimatedFeePercent: 2.5,
    geographicCoverage: "120+ countries",
    requiresKyc: true,
  },

  async createSession({ destinationAddress, amount, fiat = "USD", network = "base" }) {
    // Validate inputs (we provide reusable validators if you want — see coinbase.js)
    if (!isAddress(destinationAddress)) throw new TypeError("invalid address")

    // Call your API to create a session, return the URL the human opens.
    const response = await fetch("https://api.your-domain.com/v1/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.YOUR_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: destinationAddress,
        amount,
        currency: fiat,
        chain: network,
        token: "USDC",
      }),
    })

    const session = await response.json()

    return {
      url: session.checkout_url,    // human opens this in browser
      sessionId: session.id,        // for tracking, idempotency
      provider: "your-name",
    }
  },
}
```

That's it. Register in `lib/v2/onramp/index.js`:

```js
import { yourNameAdapter } from "./your-name.js"
ADAPTERS.set("your-name", yourNameAdapter)
```

## What you get

When agents using `@grip-labs/sdk` need to fund their wallet:

```js
const session = await client.onramp({
  provider: "your-name",
  amount: 25,
  fiat: "USD",
})

// Agent sends `session.url` to the human, who taps once and completes the buy.
```

Your provider name appears in `client.onrampProviders()` output, accessible to any dev or agent runtime.

## Default selection logic (current)

When `provider` is not specified, agents default to a deterministic order. We're working on a smart selector (`provider: "auto"`) that picks based on user geo, fiat currency, and historical success rates. If you want preferred placement, talk to us about partnership terms — `partnerships@grip.wtf`.

## What we ask of partners

1. **Self-serve API access** — agents can't sign up via your dashboard. Either give us a partner API key or accept anonymous session creation.
2. **Stable URL/contract** — once shipped, the session URL format and parameter names should be backwards-compatible for at least 12 months.
3. **Webhooks for completion** (optional but appreciated) — let agents get a callback when funding lands, instead of polling on-chain. We'll wire it through if you provide it.
4. **Clear error messages in your API** — agents read your error responses and surface them to humans. "Invalid request" won't help; "amount below $5 minimum for region X" will.

## What we're NOT asking

- We don't ask for revenue share or kickbacks (yet — that's a separate partnership conversation).
- We don't ask for exclusivity. Agents can use any combination of providers in the same session.
- We don't ask for sponsorship of paymaster gas. That's a different layer (Pimlico / Coinbase paymaster).

## Reference implementations

- `lib/v2/onramp/coinbase.js` — Coinbase Pay (CDP)
- `lib/v2/onramp/crossmint.js` — Crossmint hosted checkout
- `lib/v2/onramp/mock.js` — for testing

Both `coinbase.js` and `crossmint.js` currently ship as **stubs** (URL builders) until production credentials are wired. Useful as templates.

## Test contract

Every adapter must pass these tests (we run them in CI):

- `createSession` returns `{ url, sessionId, provider }` with a valid URL
- Rejects invalid `destinationAddress`, negative `amount`, unsupported `network` and `fiat`
- `metadata` describes the adapter accurately

See `test/v2/onramp.test.js` for the contract suite.

## Submission

To add your adapter to the public SDK:

1. Fork `grip-protocol/sdk` on GitHub
2. Add `lib/v2/onramp/your-name.js` and register in `index.js`
3. Add tests in `test/v2/onramp.test.js`
4. Open PR to `main` with a one-paragraph description of your service

We aim to merge clean PRs within 48 hours. Questions: `partnerships@grip.wtf`.

## Mid-term roadmap

- `client.onramp({ provider: "auto" })` — geo + cost-aware routing
- Multi-step flows (buy USDC → swap → fund) for non-USDC providers
- Off-ramp adapters (USDC → fiat) using the same interface
- Webhooks via Grip-hosted relay for providers without direct callback support
