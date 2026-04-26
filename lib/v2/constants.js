// Smart account + paymaster constants for v0.2
// All addresses validated on Base mainnet via spike on 2026-04-25

export const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"

// Pimlico singleton paymaster on Base, EntryPoint v0.6
// IMPORTANT: there's a different paymaster for v0.7 (0x777...). Don't confuse.
export const PIMLICO_PAYMASTER_V06_BASE = "0x6666666666667849c56f2850848cE1C4da65c68b"

export const PIMLICO_RPC_BASE = (apiKey) =>
  `https://api.pimlico.io/v2/8453/rpc?apikey=${apiKey}`

// Bootstrap costs ~$0.05 USD per new smart account (one-time CAC).
// Set generously — a tx that hits this allowance limit means the user has burned
// enough gas to invalidate our economics; better to fail loud than silently underestimate.
export const BOOTSTRAP_USDC_BUDGET_RAW = 100_000n // $0.10 USDC, in 6-decimal raw
