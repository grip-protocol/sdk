// Smart account + paymaster constants for v0.2
// All addresses validated on Base mainnet via spike on 2026-04-25

export const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"

// Pimlico singleton paymaster on Base, EntryPoint v0.6
// IMPORTANT: there's a different paymaster for v0.7 (0x777...). Don't confuse.
export const PIMLICO_PAYMASTER_V06_BASE = "0x6666666666667849c56f2850848cE1C4da65c68b"

export const PIMLICO_RPC_BASE = (apiKey) =>
  `https://api.pimlico.io/v2/8453/rpc?apikey=${apiKey}`

// Per-approval exposure, not a lifetime gas budget. Refills reset this allowance.
export const BOOTSTRAP_USDC_BUDGET_RAW = 2_000_000n // 2.00 USDC, in 6-decimal raw
export const PAYMASTER_USDC_REFILL_THRESHOLD_RAW = 500_000n // refill below 0.50 USDC
