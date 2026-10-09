// Nano Wad — a feeless, self-custodial settlement rail mirroring Grip's Wad policy API.
//
// Grip's `Wad` gives an autonomous agent a capped, allowlisted, expiring spending
// context settled in USDC on Base (smart account, ERC20 paymaster, gas in USDC).
// This example mirrors that exact policy surface — `openWad`, `evaluate`, `pay`,
// `spent` — but settles on the Nano (XNO) rail, which is feeless and sub-second,
// so a micro, recurring per-call payment does not burn more in gas + finality
// latency than the call itself is worth.
//
// The module is fully self-contained and offline: payments are simulated against a
// local settlement stub so it runs with no Nano wallet, no RPC, and no network.
// Swap `simulateSettleNano` for a real Nano send (e.g. rpc.nano.to) when you have
// a spendable XNO account.
//
// Run the self-test with:
//   node examples/nano-wad.test.mjs

// --- Nano rail facts, kept local and documented (asserted by the self-test) ---
export const NANO = Object.freeze({
  // Nano is feeless: every transfer settles with a 0 network fee.
  feePerSend: 0,
  // Like Grip's `pay` on Base, a Nano send is final once confirmed by the network.
  finality: 'confirmed',
})

const NANO_ADDR_RE = /^(nano|xrb)_[13][13-9a-km-uw-z]{59}$/i

function assertNanoAddress(addr) {
  if (typeof addr !== 'string' || !NANO_ADDR_RE.test(addr)) {
    throw new TypeError(`invalid Nano address: ${addr}`)
  }
}

function todayStartUTC() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export function parseExpiry(input) {
  if (!input) return null
  if (input instanceof Date) return input
  const m = String(input).match(/^(\d+)([dhm])$/)
  if (!m) {
    throw new TypeError(`Invalid expiresIn: "${input}". Use formats like "30d", "12h", "30m", or a Date instance.`)
  }
  const [, n, unit] = m
  const ms = { d: 86400e3, h: 3600e3, m: 60e3 }[unit] * Number(n)
  return new Date(Date.now() + ms)
}

export class NanoPolicyError extends Error {
  constructor(message, reasons) {
    super(message)
    this.name = 'NanoPolicyError'
    this.reasons = reasons
  }
}

// The offline settlement stub. In production this is a real Nano send
// (send/block RPC), which is also feeless and confirms sub-second.
export async function simulateSettleNano({ from, to, amountXno }) {
  await new Promise((r) => setTimeout(r, 1))
  return {
    hash: `nano-${to.slice(0, 12)}-${Date.now().toString(36)}`,
    status: 'confirmed',
  }
}

export class NanoWad {
  constructor({
    account,
    agentId,
    dailyCap = 100,
    perTxCap = 20,
    allowlist = [],
    expiresIn,
    settle = simulateSettleNano,
  } = {}) {
    if (!account) throw new TypeError('NanoWad requires { account }')
    if (!account.address) throw new TypeError('NanoWad.account requires { address }')
    if (typeof dailyCap !== 'number' || dailyCap < 0) {
      throw new TypeError('dailyCap must be a non-negative number')
    }
    if (typeof perTxCap !== 'number' || perTxCap < 0) {
      throw new TypeError('perTxCap must be a non-negative number')
    }

    this.account = account
    this.agentId = agentId || `agent-${Date.now()}`
    this.dailyCap = dailyCap
    this.perTxCap = perTxCap
    this.allowlist = (allowlist || []).map((a) => {
      assertNanoAddress(a)
      return a.toLowerCase()
    })
    this.expiresAt = parseExpiry(expiresIn)
    this.createdAt = new Date()
    this._spent = []
    this._settle = settle
    this._payInFlight = false
  }

  get address() {
    return this.account.address
  }

  todaySpentXno() {
    const start = todayStartUTC()
    return this._spent
      .filter((s) => s.at >= start && s.status === 'confirmed')
      .reduce((sum, s) => sum + s.amount, 0)
  }

  evaluate({ to, amount }) {
    const reasons = []
    if (this.expiresAt && new Date() > this.expiresAt) {
      reasons.push(`wad expired at ${this.expiresAt.toISOString()}`)
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      reasons.push('amount must be a positive number')
    } else {
      if (amount > this.perTxCap) {
        reasons.push(`exceeds per-tx cap ($${this.perTxCap})`)
      }
      const todayAfter = this.todaySpentXno() + amount
      if (todayAfter > this.dailyCap) {
        reasons.push(
          `would exceed daily cap ($${this.dailyCap}, spent today $${this.todaySpentXno().toFixed(2)})`,
        )
      }
    }
    if (!to) {
      reasons.push('invalid recipient address')
    } else {
      let addr
      try {
        addr = to.toLowerCase()
        assertNanoAddress(addr)
      } catch {
        reasons.push('invalid recipient address')
      }
      if (addr) {
        if (this.allowlist.length > 0 && !this.allowlist.includes(addr)) {
          reasons.push('recipient not on allowlist')
        }
      }
    }
    return { ok: reasons.length === 0, reasons }
  }

  async pay({ to, amount }) {
    if (this._payInFlight) {
      throw new NanoPolicyError('a payment is already in flight on this wad', ['concurrent pay()'])
    }
    const verdict = this.evaluate({ to, amount })
    if (!verdict.ok) {
      throw new NanoPolicyError(`payment blocked: ${verdict.reasons.join(', ')}`, verdict.reasons)
    }

    this._payInFlight = true
    const entry = { amount, to: to.toLowerCase(), hash: null, at: new Date(), status: 'pending' }
    this._spent.push(entry)
    try {
      const result = await this._settle({ from: this.address, to, amountXno: amount })
      entry.hash = result.hash
      entry.status = result.status === 'confirmed' ? 'confirmed' : 'failed'
      entry.fee = 0
      return {
        hash: result.hash,
        status: entry.status,
        fee: 0,
        finality: NANO.finality,
      }
    } catch (err) {
      entry.status = 'failed'
      entry.error = err.message
      throw err
    } finally {
      this._payInFlight = false
    }
  }

  spent() {
    const today = this.todaySpentXno()
    return {
      today: {
        used: today,
        cap: this.dailyCap,
        remaining: Math.max(0, this.dailyCap - today),
      },
      perTx: { cap: this.perTxCap },
      total: this._spent.length,
      lastTx: this._spent.at(-1) || null,
    }
  }

  toJSON() {
    return {
      agentId: this.agentId,
      address: this.address,
      dailyCap: this.dailyCap,
      perTxCap: this.perTxCap,
      allowlist: this.allowlist,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
      rail: 'nano (xno)',
      feePerSend: NANO.feePerSend,
      ...this.spent(),
    }
  }
}

export default NanoWad
