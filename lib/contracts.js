export const VERSION = "0.1.0"

export const NETWORKS = {
  base: {
    chainId: 8453,
    name: "base",
    defaultRpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    grip: {
      agentDID: "0x2998b171DdE4AA87ae66AaeF8580875270D27B9b",
      serviceEscrow: "0x1A8B14357187aDE27A9e042269C53576e08E7f8D",
      sessionKeyManager: "0x770A702C2F0CECBD1f54513fBE850e75FCC76BF8",
      agentRegistry: "0xaCeaB1d37bc6450348C8599ce407ad339F4f40E4",
      paymaster: "0x4351c497ac1d62e2664E4e46D3731c3602d33463",
    },
  },
}

export const CONTRACTS = {
  base: {
    chainId: NETWORKS.base.chainId,
    AgentDID: NETWORKS.base.grip.agentDID,
    ServiceEscrow: NETWORKS.base.grip.serviceEscrow,
    SessionKeyManager: NETWORKS.base.grip.sessionKeyManager,
    AgentRegistry: NETWORKS.base.grip.agentRegistry,
    GripPaymaster: NETWORKS.base.grip.paymaster,
    USDC: NETWORKS.base.usdc,
  },
}
