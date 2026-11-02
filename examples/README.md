# Examples

Self-contained examples that reuse the Grip `Wad` policy model on other settlement rails.

## `nano-wad.mjs` — a feeless Nano (XNO) rail

Grip's `Wad` gives an autonomous agent a capped, allowlisted, expiring spending context
settled in USDC on Base. `nano-wad.mjs` mirrors that exact policy surface — `openWad`,
`evaluate`, `pay`, `spent` — but settles on the **Nano (XNO)** rail, which is **feeless**
and **sub-second**, so a micro, recurring, per-call payment does not burn more in gas and
finality latency than the call itself is worth.

```js
import { NanoWad } from './nano-wad.mjs'

const wad = new NanoWad({
  account: { address: process.env.AGENT_XNO_ADDRESS }, // self-custodial Nano account
  dailyCap: 25,
  perTxCap: 5,
  allowlist: ['nano_1yo6...'], // optional: only pay these recipients
  expiresIn: '30d',
})

const r = await wad.pay({ to: 'nano_1yo6...', amount: 2.5 })
// { hash, status: 'confirmed', fee: 0, finality: 'confirmed' }
```

When to use the feeless rail vs the USDC smart-account rail:

| | Grip Wad (USDC on Base) | Nano Wad (XNO) |
|---|---|---|
| Fee per send | gas in USDC (paymaster) | **0** (feeless) |
| Finality | depends on L2 confirmations | sub-second |
| Self-custody | Coinbase Smart Wallet (smart-account) | Nano address (self-custodial) |
| Best for | policy-governed, larger, app-platform payments | micro / recurring / per-call agent payments |

The module is fully self-contained and offline: payments are simulated against a local
settlement stub (`simulateSettleNano`), so it runs with no Nano wallet, no RPC and no
network. Swap `simulateSettleNano` for a real Nano send (e.g. rpc.nano.to) to go live —
the real send is also feeless and confirms sub-second, so nothing about the tradeoff changes.

### Run the self-test

```bash
node --test examples/nano-wad.test.mjs
```

No dependencies beyond Node's built-in `node:test`.
