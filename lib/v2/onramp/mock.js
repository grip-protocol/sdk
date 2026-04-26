// Mock onramp adapter — for unit tests and dev environments without real provider creds.
// Returns deterministic synthetic responses matching the OnrampAdapter contract shape.

import { isAddress } from "viem"

export const mockAdapter = {
  name: "mock",

  metadata: {
    displayName: "Mock Onramp (testing only)",
    description: "Synthetic adapter for tests. Does not move real money.",
    supportedFiatCurrencies: ["USD"],
    supportedCryptoCurrencies: ["USDC"],
    supportedNetworks: ["base"],
    estimatedFeePercent: 0,
    geographicCoverage: "test only",
    requiresKyc: false,
  },

  async createSession({ destinationAddress, amount, fiat = "USD", network = "base" }) {
    if (!isAddress(destinationAddress)) {
      throw new TypeError(`destinationAddress must be a valid 0x address`)
    }
    if (typeof amount !== "number" || amount <= 0) {
      throw new TypeError(`amount must be positive`)
    }
    return {
      url: `https://mock.example/onramp?to=${destinationAddress}&amount=${amount}&fiat=${fiat}&net=${network}`,
      sessionId: `mock-${destinationAddress.slice(2, 10)}-${amount}`,
      isStub: false,
      isMock: true,
      provider: "mock",
    }
  },
}
