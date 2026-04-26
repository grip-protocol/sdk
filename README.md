# @grip-labs/sdk

**Money rails for software that spends.**

Smart-account wallets, limits, and approvals for autonomous agents on Base. Gas paid in USDC — no ETH needed.

```bash
npm install @grip-labs/sdk
```

## Quick start

> **New here?** Follow the step-by-step **[QUICKSTART.md](./QUICKSTART.md)** — a real 5-min path to your first payment, written by the dev who lived the first-user experience.
>
> **Are you an AI agent installing this on your own?** Read **[AGENT_INSTALL.md](./AGENT_INSTALL.md)** instead — the human only needs to fund a wallet (one tap), the rest is on you.

### Easiest mode (managed, zero signups)

```js
import { grip } from '@grip-labs/sdk'

const client = grip.init({
  account: process.env.AGENT_PRIVATE_KEY,
  managed: true, // uses Grip's hosted paymaster proxy — no Pimlico signup
})
```

That's it. No Pimlico key, no Coinbase signup, no third-party accounts. Fund the wallet with USDC and pay.

### Self-managed mode (BYOK Pimlico)

```js
import { grip } from '@grip-labs/sdk'

const client = grip.init({
  account: process.env.AGENT_PRIVATE_KEY, // 0x-prefixed hex pk
  pimlicoApiKey: process.env.GRIP_PIMLICO_KEY, // get one at pimlico.io
  // mode: 'smart' is the default
})

const smartAddress = await client.address()
console.log('Send USDC to:', smartAddress)

const wad = await client.openWad({
  agentId: 'pi-research',
  dailyCap: 25,
  perTxCap: 20,
  allowlist: ['0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A'],
  expiresIn: '30d',
})

const result = await wad.pay({
  to: '0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A',
  amount: 2.50,
})
console.log(result.basescanUrl)
```

That's it. The agent never holds ETH. Gas is paid in USDC by the smart account itself, no top-up needed.

## What ships in v0.2.0

- **Smart account mode (default)** — Coinbase Smart Wallet derived from any signer
- **Sponsored bootstrap** — first UserOp deploys the smart account and sets up the paymaster, gas paid by Grip Labs (~$0.05 one-time CAC per user)
- **ERC20 paymaster forever after** — every subsequent payment pays its own gas in USDC, no ETH ever required
- **Same Wad API as v0.1** — `openWad`, `pay`, `evaluate`, `spent` all work the same
- **Backwards compat** — pass `mode: 'eoa'` to use the v0.1 direct-EOA flow

## v0.1 → v0.2 migration

In v0.1, your `account` was an EOA — that's where USDC sat.
In v0.2 smart mode, `account` is the **signer**. The USDC sits in a separate **smart account** address (a Coinbase Smart Wallet contract derived from your signer).

```js
const client = grip.init({ account, mode: 'smart', pimlicoApiKey })

console.log('signer (EOA):     ', client.eoaAddress)
console.log('wallet (smart):   ', await client.address())  // ← fund this
```

Send USDC to the smart account address. The signer just signs UserOps — it doesn't hold funds.

If you have USDC sitting in your v0.1 EOA, transfer it to the new smart account address with a regular tx.

## Modes

### `mode: 'smart'` (default)

The way forward. Smart account + paymaster. Agent never needs ETH.

Required option: `pimlicoApiKey` (or env var `GRIP_PIMLICO_KEY`).

### `mode: 'eoa'` (v0.1 compat)

Direct EOA signing. Agent holds and signs from a regular EOA. **Requires ETH for gas**. Use this only for v0.1 backwards compatibility or environments where smart accounts aren't viable.

## API

### `grip.init(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `account` | `0x${string}` \| viem Account | — | Required. Hex private key or viem Account. |
| `mode` | `"smart"` \| `"eoa"` | `"smart"` | Account model. |
| `pimlicoApiKey` | `string` | env `GRIP_PIMLICO_KEY` | Required for smart mode. |
| `network` | `"base"` | `"base"` | Currently only Base mainnet. |
| `rpc` | `string` | `https://mainnet.base.org` | Custom RPC URL. |

Returns: client object. Methods differ slightly between modes:

| Method | smart mode | eoa mode |
|--------|-----------|----------|
| `client.address` | `async () => 0x...` (smart account) | `0x...` (EOA, sync) |
| `client.balance()` | reads smart account USDC | reads EOA USDC |
| `client.openWad(opts)` | `async`, returns `SmartWad` | sync, returns `Wad` |
| `client.state()` | smart-mode only — bootstrap status | — |
| `client.eoaAddress` | smart-mode only — underlying signer | — |

### `client.openWad(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentId` | `string` | `agent-<timestamp>` | Identifier for logging. |
| `dailyCap` | `number` | `100` | USD per UTC day. |
| `perTxCap` | `number` | `20` | USD per transaction. |
| `allowlist` | `0x${string}[]` | `[]` | Empty = open mode. |
| `expiresIn` | `string` \| `Date` | — | `"30d"`, `"12h"`, `"30m"`, or a Date. |

### `wad.pay({ to, amount })`

In smart mode, the first `pay()` triggers a one-time bootstrap (sponsored) and then the actual transfer (gas paid in USDC).

```ts
{
  hash, opHash, status: 'confirmed' | 'failed',
  basescanUrl, blockNumber,
  bootstrapTxHash,  // tx hash of the bootstrap, null if already done
  paymaster,        // address of the paymaster that paid gas
}
```

Throws `GripPolicyError` if caps or allowlist would be violated.

## How sponsored bootstrap works

When a smart account uses Grip for the first time:

1. SDK detects no on-chain code at the smart account address (or no paymaster allowance).
2. SDK constructs a UserOp that deploys the smart account AND approves the Pimlico paymaster for max USDC.
3. **The UserOp is sponsored** — Grip Labs pays the gas (~$0.05 USD) via Pimlico's verifying paymaster.
4. After this single bootstrap, every subsequent UserOp uses the **ERC20 paymaster mode**: the user's smart account pays gas itself in USDC. No more sponsorship needed.

So: $0.05 of CAC for us per new user, then sustainable forever. Users never need ETH.

## On-chain context

Live on Base mainnet (chain `8453`):

| Contract | Address |
|----------|---------|
| `AgentDID` | `0x2998b171DdE4AA87ae66AaeF8580875270D27B9b` |
| `ServiceEscrow` | `0x1A8B14357187aDE27A9e042269C53576e08E7f8D` |
| `SessionKeyManager` | `0x770A702C2F0CECBD1f54513fBE850e75FCC76BF8` |
| `AgentRegistry` | `0xaCeaB1d37bc6450348C8599ce407ad339F4f40E4` |
| `GripPaymaster` | `0x4351c497ac1d62e2664E4e46D3731c3602d33463` |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

External deps (validated on mainnet):

| | Address |
|---|---|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| Pimlico paymaster (v0.6) | `0x6666666666667849c56f2850848cE1C4da65c68b` |

```js
import { CONTRACTS } from '@grip-labs/sdk'
console.log(CONTRACTS.base.SessionKeyManager)
```

## Roadmap

- **v0.2.x** — smart account + sponsored bootstrap + ERC20 paymaster (current)
- **v0.3.x** — caps enforced on-chain via `SessionKeyManager`
- **v0.4.x** — Telegram approval cards for cap-exceeded payments
- **v0.5.x** — passkey signers (consumer mode), email recovery, fiat onramp partners
- **v1.0** — multi-chain (Arbitrum, Optimism), batched recipients, off-chain rails

## License

MIT — Copyright (c) 2026 Grip Labs

Track progress at [grip.wtf](https://grip.wtf). Protocol contracts at [github.com/grip-foundation/protocol](https://github.com/grip-foundation/protocol).
