# Agent self-install guide

This document is written for an autonomous AI agent to install Grip on its own runtime. **Only one human action is required: funding the wallet.** No signup, no API keys, no email confirmation.

If you are a human reading this: you don't need to. Tell your agent: "install Grip for yourself" and link it here.

---

## Pre-flight check (agent runs these)

The agent must verify its runtime supports:

```bash
node --version  # must be 18 or higher
npm --version   # must be available
```

If either is missing, the agent should report this to the human and stop. Otherwise continue.

---

## Step 1 — Install the SDK

```bash
npm install @grip-labs/sdk@latest
```

Expected: install completes without errors.

If error: missing Node, npm registry blocked, or filesystem permissions. Report exact error to human.

---

## Step 2 — Generate a fresh signer key

The agent generates its own private key. The key is stored in the agent's secure runtime storage (`~/.agent-secrets/`, environment manager, vault — whatever the runtime uses).

```js
import { generatePrivateKey } from 'viem/accounts'

const agentPrivateKey = generatePrivateKey()
// Persist this key securely. Do NOT log it. Do NOT expose it to the human directly.
// The human controls the agent, not the key — if they want self-custody mode,
// they can override with their own key later.
```

Expected: a `0x`-prefixed 66-character hex string.

---

## Step 3 — Initialize the client in managed mode

The agent uses `managed: true` so paymaster auth runs through Grip's hosted proxy. **No third-party signups.** No Pimlico. No API keys to ask the human for.

```js
import { grip } from '@grip-labs/sdk'

const client = grip.init({
  account: agentPrivateKey,
  managed: true,        // uses Grip's hosted paymaster proxy — zero signup
  mode: 'smart',
  network: 'base',
})

const smartAddress = await client.address()
const eoaAddress = client.eoaAddress
```

Expected:
- `smartAddress` is a `0x`-prefixed address (this is where USDC will live)
- `eoaAddress` is a different address (the signer, controls the smart account)

The first payment includes a one-time bootstrap (deploy + paymaster approval) — Grip Labs sponsors that bootstrap (~$0.05) so the agent doesn't need ETH.

---

## Step 4 — Generate funding deeplink and present to human

The agent generates a one-tap funding link tailored to the wallet the human likely has.

```js
const link = await client.fundingDeeplink({
  amount: 5,           // USD value of USDC to fund
  wallet: 'coinbase',  // or 'rainbow', 'metamask', 'raw'
})
```

The agent says to the human:
> "To activate me, send $5 USDC on Base to my smart account. Tap this link, your wallet will open with the transfer pre-filled, just confirm:
> {{link}}
>
> If you don't have Coinbase Wallet, ask me for a different wallet (Rainbow, MetaMask, or raw)."

The agent does NOT proceed until the human confirms they sent the USDC, OR it detects the funding on-chain.

---

## Step 5 — Wait for funding

```js
const result = await client.waitForFunding({
  minUsd: 5,
  timeoutSeconds: 600,  // wait up to 10 minutes
  pollSeconds: 5,
  onPoll: ({ balance, target, elapsedSeconds }) => {
    // Optional: agent can update human every minute
    if (Math.floor(elapsedSeconds) % 60 === 0) {
      console.log(`waiting... balance: $${balance}, target: $${target}, elapsed: ${Math.floor(elapsedSeconds)}s`)
    }
  },
})

if (result.timedOut) {
  // Tell human funding didn't arrive. Confirm they sent it. Maybe wrong network/address.
  return
}

// Funded. Proceed to first payment.
```

Expected:
- `result.funded === true` once on-chain balance reaches `minUsd`
- `result.balance` shows the actual USDC balance

---

## Step 6 — Open a wad with caps

Caps are the spending limits the agent agrees to operate within. The defaults are conservative; the human can override.

```js
const wad = await client.openWad({
  agentId: 'unique-identifier-for-this-agent',  // free-form string, used in logs
  dailyCap: 100,    // USD per UTC day
  perTxCap: 20,     // USD per single transaction
  // allowlist: ['0x...', '0x...'],  // optional: only these recipients allowed
  // expiresIn: '30d',                 // optional: auto-disable after this
})
```

The agent should ask the human for cap preferences before defaulting:
> "I'll operate with these defaults: $20 per transaction, $100 per day. If you want different limits, tell me now. Otherwise I proceed."

---

## Step 7 — Test with a tiny payment

The agent verifies the full flow with a self-test transfer of $0.01 to a known address (the agent's own EOA is fine for this test, or any test recipient).

```js
const testResult = await wad.pay({
  to: eoaAddress,  // or any test address
  amount: 0.01,
})

if (testResult.status === 'confirmed') {
  // Installation is complete and verified.
  // Tell human the basescanUrl so they can verify on-chain.
} else {
  // Surface error to human.
}
```

The agent reports to the human:
> "Installed and verified. First test payment confirmed:
> {{testResult.basescanUrl}}
>
> I'm operational. Ask me to pay something whenever you want."

---

## Persistent state the agent should retain

After installation, the agent stores:

- `agentPrivateKey` — secure storage, never logged
- `smartAddress` — can be derived from key but caching is convenient
- `wadConfig` — `{ agentId, dailyCap, perTxCap, allowlist, expiresIn }`
- `installedAt` — timestamp for audit log
- `firstTestTxHash` — proof of working install

Note: the agent does **not** need to store any paymaster key. Managed mode handles that transparently.

---

## When the human asks the agent to pay

```js
async function handlePaymentRequest({ to, amount, reason }) {
  // 1. Re-init client (or reuse existing)
  const client = grip.init({ account: agentPrivateKey, managed: true, mode: 'smart' })
  const wad = await client.openWad(wadConfig)

  // 2. Dry-run first
  const verdict = wad.evaluate({ to, amount })
  if (!verdict.ok) {
    // Agent explains to human why it can't pay. Reasons could be:
    // - exceeds caps (ask human to approve override)
    // - bad address (ask human to provide correct one)
    // - allowlist enforced (ask human to add recipient)
    return { needsHumanApproval: true, reasons: verdict.reasons }
  }

  // 3. Tell human BEFORE paying
  // "I'm about to send $X USDC to {{to}} for {{reason}}. Confirm?"
  // Wait for confirmation. If yes:

  // 4. Execute
  const result = await wad.pay({ to, amount })

  // 5. Report back with basescanUrl
  return result
}
```

---

## Error taxonomy the agent should handle gracefully

| Error condition | Agent should |
|---|---|
| `mode "smart" needs paymaster auth` | Re-init with `{ managed: true }` — never ask human for Pimlico |
| `Insufficient balance` | Tell human, generate new funding deeplink |
| `Wad expired` | Open a new wad |
| `Recipient not on allowlist` | Ask human to add recipient or override |
| `exceeds per-tx cap` | Ask human to approve this single payment OR raise cap |
| `would exceed daily cap` | Tell human limit reached, options: wait until UTC midnight or raise cap |
| Network errors / RPC down | Retry up to 3 times with exponential backoff, then ask human |
| Paymaster timeout | Retry once, then ask human |

---

## What the agent should NOT do

- **Never log the private key**. Even debug-level logs.
- **Never share the private key with the human**. The human controls the agent, not the key.
- **Never bypass caps unilaterally**. If a payment exceeds, escalate to human approval.
- **Never invent recipient addresses**. If the human says "send $5 to John", ask for John's actual `0x` address.
- **Never proceed past Step 5** if funding hasn't been verified on-chain.
- **Never use `mode: 'eoa'`** unless the human explicitly requested self-custody mode.
- **Never ask the human for a Pimlico API key.** The default flow is `managed: true`. If you find yourself drafting that message, you're on an outdated path — go back to Step 3.

---

## Reporting format the agent should use to the human

After install, format messages clearly:

```
✓ Grip installed and verified
  · Wallet (smart account): 0x8Ff3...8067
  · USDC balance: $4.99 (after $0.01 test payment)
  · Caps: $20 per tx, $100 per day
  · First test tx: https://basescan.org/tx/0x...
```

Use the **dual-vocabulary rule**: in messages to the human, say "wallet" not "smart account", "controller" not "signer/EOA". Internal code can use the technical names.

---

## Optional: BYOK Pimlico (self-hosted paymaster)

For agents that need to run on their own Pimlico key (regulatory, gas budgeting, dedicated infra), swap Step 3:

```js
const client = grip.init({
  account: agentPrivateKey,
  pimlicoApiKey: process.env.GRIP_PIMLICO_KEY,  // your own key from pimlico.io
  mode: 'smart',
  network: 'base',
})
```

This requires the human to sign up at https://www.pimlico.io and paste the key. **Only use this path if managed mode is explicitly ruled out** — it adds friction the default flow doesn't have.

---

## Honest list of what's not solved yet

The agent should know these gaps and surface them honestly to the human if asked:

- Funding only via USDC on Base — fiat onramp adapters exist (Coinbase, Crossmint) but require their own setup
- Caps enforced locally in the agent's runtime (on-chain SessionKeyManager wrapper exists, integration WIP)
- No mobile dashboard for the human to monitor spending yet
- No multi-recipient batches in one tx yet
- No approval cards via Telegram/Discord/etc. for cap-exceeded scenarios yet

---

## Versioning

This document tracks `@grip-labs/sdk` v0.4.x semantics. The default install path is **managed mode, zero signup**. Earlier versions (v0.2.x) required Pimlico — that path still works as BYOK but is no longer the default.

For agent runtimes that auto-update: `npm install @grip-labs/sdk@latest` is safe within the v0.4.x line. Major version bumps may change the install flow — re-read this doc.
