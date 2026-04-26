// Onramp adapter pattern — pluggable fiat→USDC providers.
// Each provider implements the OnrampAdapter interface and registers itself here.
//
// Adding a new provider: see /ONRAMP_INTEGRATION.md
// Existing adapters: coinbase, crossmint, mock (for testing)

import { coinbaseAdapter } from "./coinbase.js"
import { crossmintAdapter } from "./crossmint.js"
import { mockAdapter } from "./mock.js"

const ADAPTERS = new Map([
  ["coinbase", coinbaseAdapter],
  ["crossmint", crossmintAdapter],
  ["mock", mockAdapter],
])

export function getAdapter(name) {
  const adapter = ADAPTERS.get(name)
  if (!adapter) {
    throw new TypeError(
      `Unknown onramp provider: "${name}". Available: ${[...ADAPTERS.keys()].join(", ")}. ` +
      `See ONRAMP_INTEGRATION.md to add a new provider.`,
    )
  }
  return adapter
}

export function listProviders() {
  return [...ADAPTERS.keys()].filter((k) => k !== "mock")
}

export function registerAdapter(name, adapter) {
  // Allow runtime registration (for plugins / custom providers).
  // Does NOT validate adapter shape — caller is responsible.
  ADAPTERS.set(name, adapter)
}

export { coinbaseAdapter, crossmintAdapter, mockAdapter }
