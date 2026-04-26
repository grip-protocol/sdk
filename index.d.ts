import type { Account } from "viem"

export declare const VERSION: string

export interface ContractMap {
  base: {
    chainId: number
    AgentDID: `0x${string}`
    ServiceEscrow: `0x${string}`
    SessionKeyManager: `0x${string}`
    AgentRegistry: `0x${string}`
    GripPaymaster: `0x${string}`
    USDC: `0x${string}`
  }
}

export declare const CONTRACTS: ContractMap

export interface NetworkDefinition {
  chainId: number
  name: string
  defaultRpc: string
  explorer: string
  usdc: `0x${string}`
  grip: {
    agentDID: `0x${string}`
    serviceEscrow: `0x${string}`
    sessionKeyManager: `0x${string}`
    agentRegistry: `0x${string}`
    paymaster: `0x${string}`
  }
}

export declare const NETWORKS: { base: NetworkDefinition }

export type SupportedNetwork = "base"

export interface InitOptions {
  account: `0x${string}` | Account
  network?: SupportedNetwork
  rpc?: string
}

export interface Balance {
  raw: bigint
  formatted: string
  usd: number
}

export interface OpenWadOptions {
  agentId?: string
  dailyCap?: number
  perTxCap?: number
  allowlist?: `0x${string}`[]
  expiresIn?: string | Date
}

export interface PayInput {
  to: `0x${string}`
  amount: number
}

export interface PayResult {
  hash: `0x${string}`
  status: "confirmed" | "failed"
  basescanUrl: string
  blockNumber: string
}

export interface SpentSnapshot {
  today: { used: number; cap: number; remaining: number }
  perTx: { cap: number }
  total: number
  lastTx: SpentEntry | null
}

export interface SpentEntry {
  amount: number
  to: `0x${string}`
  hash: `0x${string}` | null
  at: Date
  status: "pending" | "confirmed" | "failed"
  blockNumber?: string
  error?: string
}

export interface EvaluateResult {
  ok: boolean
  reasons: string[]
}

export declare class Wad {
  readonly address: `0x${string}`
  readonly agentId: string
  readonly dailyCap: number
  readonly perTxCap: number
  readonly allowlist: string[]
  readonly expiresAt: Date | null
  readonly createdAt: Date
  todaySpentUsd(): number
  evaluate(input: PayInput): EvaluateResult
  pay(input: PayInput): Promise<PayResult>
  spent(): SpentSnapshot
  toJSON(): object
}

export declare class GripPolicyError extends Error {
  reasons: string[]
}

export interface GripClient {
  address: `0x${string}`
  network: string
  chainId: number
  openWad(opts?: OpenWadOptions): Wad
  balance(): Promise<Balance>
}

export declare function init(opts: InitOptions): GripClient
export declare function parseExpiry(input: string | Date | null | undefined): Date | null
export declare function adaptAccount(input: `0x${string}` | Account): Account

export declare const USDC_DECIMALS: 6

export declare function readUsdcBalance(args: { address: `0x${string}`; network: NetworkDefinition }): Promise<Balance>
export declare function transferUsdc(args: {
  account: Account
  to: `0x${string}`
  amountUsd: number
  network: NetworkDefinition
}): Promise<{ hash: `0x${string}`; status: string; blockNumber: string }>

export declare const grip: {
  init: typeof init
  VERSION: string
  CONTRACTS: ContractMap
}

export default grip
