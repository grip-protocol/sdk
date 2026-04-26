# Quickstart

A real 5-minute path to your first payment.

This is written from the first-user path we actually ran on Base mainnet with `@grip-labs/sdk@0.2.1`.

If you want the short version:
- bring a signer
- derive a smart account
- fund the smart account with USDC on Base
- make the first payment
- wait a bit longer on the first pay

## Before you start

You need:
- Node 18+
- USDC on Base
- a Pimlico API key
- a private key for your signer

Create a clean folder:

```bash
mkdir grip-quickstart && cd grip-quickstart
npm init -y
npm install @grip-labs/sdk@0.2.1
```

What you should see:
- npm installs without errors
- `package.json` exists
- `node_modules/@grip-labs/sdk` exists

Most likely error:
- `npm: command not found`
- Fix: install Node.js 18+ first

Why this step?
**Get the SDK into your project.**

Estimated time: 1 minute

---

## Step 1. Save your keys

Create a local env file:

```bash
cat > .env <<'EOF'
AGENT_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
GRIP_PIMLICO_KEY=your_pimlico_key
EOF
```

What you should see:
- `.env` created in your project folder

Most likely error:
- pasted private key without `0x`
- Fix: use a 32-byte hex private key with `0x` prefix

Why this step?
**This gives the SDK your signer.**

Estimated time: 1 minute

---

## Step 2. Ask the SDK for your wallet address

Create `quickstart.mjs`:

```js
import fs from 'node:fs'
import { grip } from '@grip-labs/sdk'

const account = process.env.AGENT_PRIVATE_KEY || fs.readFileSync('.env', 'utf8').match(/AGENT_PRIVATE_KEY=(.*)/)?.[1]?.trim()
const pimlicoApiKey = process.env.GRIP_PIMLICO_KEY || fs.readFileSync('.env', 'utf8').match(/GRIP_PIMLICO_KEY=(.*)/)?.[1]?.trim()

const client = grip.init({
  account,
  pimlicoApiKey,
  mode: 'smart',
  network: 'base',
})

console.log('signer (EOA):   ', client.eoaAddress)
console.log('wallet (smart): ', await client.address())
```

Run it:

```bash
node quickstart.mjs
```

What you should see:
- one **signer** address
- one different **wallet (smart)** address

Example:

```bash
signer (EOA):    0x4073B44f0DEe547c529b0F892d2B90cf9124a765
wallet (smart):  0x2F6789008B945cc65F2B3A3F08E40fA459571dc7
```

Most likely error:
- `pimlicoApiKey is required` or similar init failure
- Fix: check `GRIP_PIMLICO_KEY`

Why this step?
**This gives your agent a smart account.**

Estimated time: 1 minute

---

## Step 3. Fund the smart account, not the signer

Send USDC on Base to the **wallet (smart)** address from Step 2.

Not the signer. The signer only signs. The smart account holds the USDC.

Tip:
- **$5 USDC is enough** to test most flows

What you should see:
- your wallet app/explorer shows incoming USDC on the smart account

Most likely error:
- funded the signer address by mistake
- Fix: transfer that USDC to the smart account, then continue

Why this step?
**This is the address you fund.**

Estimated time: 1 to 3 minutes

---

## Step 4. Check balance

Replace `quickstart.mjs` with:

```js
import fs from 'node:fs'
import { grip } from '@grip-labs/sdk'

const env = fs.readFileSync('.env', 'utf8')
const account = process.env.AGENT_PRIVATE_KEY || env.match(/AGENT_PRIVATE_KEY=(.*)/)?.[1]?.trim()
const pimlicoApiKey = process.env.GRIP_PIMLICO_KEY || env.match(/GRIP_PIMLICO_KEY=(.*)/)?.[1]?.trim()

const client = grip.init({
  account,
  pimlicoApiKey,
  mode: 'smart',
  network: 'base',
})

const smartAddress = await client.address()
const balance = await client.balance()

console.log('wallet (smart): ', smartAddress)
console.log('balance (USDC): ', balance.formatted)
```

Run it:

```bash
node quickstart.mjs
```

What you should see:

```bash
wallet (smart):  0x2F6789008B945cc65F2B3A3F08E40fA459571dc7
balance (USDC):  1.896578
```

Most likely error:
- balance is `0`
- Fix: you either funded the wrong address or the transfer has not landed yet

Why this step?
**Check funds before your first payment.**

Estimated time: 30 seconds

---

## Step 5. Make your first payment

Replace `quickstart.mjs` with:

```js
import fs from 'node:fs'
import { grip } from '@grip-labs/sdk'

const env = fs.readFileSync('.env', 'utf8')
const account = process.env.AGENT_PRIVATE_KEY || env.match(/AGENT_PRIVATE_KEY=(.*)/)?.[1]?.trim()
const pimlicoApiKey = process.env.GRIP_PIMLICO_KEY || env.match(/GRIP_PIMLICO_KEY=(.*)/)?.[1]?.trim()

const client = grip.init({
  account,
  pimlicoApiKey,
  mode: 'smart',
  network: 'base',
})

const wad = await client.openWad({
  agentId: 'quickstart-demo',
  dailyCap: 25,
  perTxCap: 20,
})

const result = await wad.pay({
  to: '0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A',
  amount: 0.10,
})

console.log(result)
```

Run it:

```bash
node quickstart.mjs
```

What you should see:
- a confirmed tx result
- a `basescanUrl`
- possibly a `bootstrapTxHash` on first wallet setup
- a `paymaster` address

Real example:

```js
{
  hash: '0x5b6ed26bb589dae616e243a217c4c8ec8f1136843aee7c06583e4fca1fb9bc2b',
  opHash: '0x2dea68d100216da2264fa6c142dcd14a3c6f13a9f82c4f9af934a6a7e4f0c43e',
  status: 'confirmed',
  basescanUrl: 'https://basescan.org/tx/0x5b6ed26bb589dae616e243a217c4c8ec8f1136843aee7c06583e4fca1fb9bc2b',
  blockNumber: '45193615',
  bootstrapTxHash: null,
  paymaster: '0x6666666666667849c56f2850848cE1C4da65c68b'
}
```

Most likely error:
- `insufficient balance`
- Fix: fund the smart account with more USDC

Why this step?
**First payment also sets up wallet.**

Estimated time: 15 seconds first pay, then ~3 seconds after

Important:
**First pay takes longer (~15s).**
That’s the one-time wallet setup. Subsequent pays are usually ~3 seconds.

Note: if this is your wallet's first ever payment, `bootstrapTxHash` will contain a real hash for the one-time wallet setup. On later payments it will be `null`.

---

## Step 6. Add one policy check

Before paying, test `evaluate()`:

```js
import fs from 'node:fs'
import { grip } from '@grip-labs/sdk'

const env = fs.readFileSync('.env', 'utf8')
const account = process.env.AGENT_PRIVATE_KEY || env.match(/AGENT_PRIVATE_KEY=(.*)/)?.[1]?.trim()
const pimlicoApiKey = process.env.GRIP_PIMLICO_KEY || env.match(/GRIP_PIMLICO_KEY=(.*)/)?.[1]?.trim()

const client = grip.init({
  account,
  pimlicoApiKey,
  mode: 'smart',
  network: 'base',
})

const wad = await client.openWad({
  agentId: 'quickstart-demo',
  dailyCap: 25,
  perTxCap: 20,
})

console.log(wad.evaluate({
  to: '0x46c3519bf9A9F3Dc588191Bc0a5043B5202C3E0A',
  amount: 0.10,
}))
```

What you should see:

```js
{ ok: true, reasons: [] }
```

Most likely error:
- `ok: false`
- Fix: check cap values, amount, or recipient address

Why this step?
**Dry-run before you spend real money.**

Estimated time: 30 seconds

---

## Common gotchas

### I funded the wrong address
In smart mode, fund `await client.address()`.
Do **not** fund `client.eoaAddress` unless you intentionally want funds on the signer.

### My first payment feels slow
That is normal.
The first payment includes one-time smart wallet setup and paymaster approval.

### I do not have ETH
That is fine.
In smart mode, you do not need ETH in the smart account.
Gas is handled through the paymaster flow.

### My payment failed with a bad address error
Use a valid `0x...` address on Base.
Checksum is fine, lowercase is also fine, but the address must be real hex.

### My balance is zero after funding
You probably funded the signer instead of the smart account.
Print both addresses again and compare.

---

## What's NOT covered yet

Honest list, from the real first-user path:

- Telegram bot integration path is not covered here
- Approval-card UX is not covered here
- Multi-user wallet lifecycle is not covered here
- Recovery / key rotation is not covered here
- Clear migration guide for moving old v0.1 EOA funds is still thin
- Better local-dev guidance for Supabase function serving is still needed
- Error taxonomy could be more explicit around paymaster/RPC/bootstrap failures
- Consumer-friendly copy and dev-facing copy still need stricter separation in docs

---

## What this quickstart proves

If you complete the steps above, you have already proven:
- your signer works
- your smart account derives correctly
- your smart account can hold USDC
- your first payment can settle on Base
- the paymaster path works without ETH

That is enough to start integrating a real agent.
