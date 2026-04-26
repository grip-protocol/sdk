// v0.2 Wad — same API surface as v0.1 Wad but routes through smart account + paymaster.
// Caps are still enforced locally in v0.2.x. v0.3.x ties them to SessionKeyManager.

import { isAddress, getAddress } from "viem"
import { GripPolicyError, parseExpiry } from "../wad.js"

function todayStartUTC() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export class SmartWad {
  constructor({
    spendClient,
    agentId,
    dailyCap = 100,
    perTxCap = 20,
    allowlist = [],
    expiresIn,
  } = {}) {
    if (!spendClient) throw new TypeError("SmartWad requires { spendClient }")
    if (typeof dailyCap !== "number" || dailyCap < 0) throw new TypeError(`dailyCap must be a non-negative number`)
    if (typeof perTxCap !== "number" || perTxCap < 0) throw new TypeError(`perTxCap must be a non-negative number`)

    this.spendClient = spendClient
    this.agentId = agentId || `agent-${Date.now()}`
    this.dailyCap = dailyCap
    this.perTxCap = perTxCap
    this.allowlist = (allowlist || []).map((a) => {
      if (!isAddress(a)) throw new TypeError(`allowlist contains invalid address: ${a}`)
      return getAddress(a).toLowerCase()
    })
    this.expiresAt = parseExpiry(expiresIn)
    this.createdAt = new Date()
    this._spent = []
    this._payInFlight = false
  }

  get address() {
    return this.spendClient.address
  }

  todaySpentUsd() {
    const start = todayStartUTC()
    return this._spent
      .filter((s) => s.at >= start && s.status === "confirmed")
      .reduce((sum, s) => sum + s.amount, 0)
  }

  evaluate({ to, amount }) {
    const reasons = []
    if (this.expiresAt && new Date() > this.expiresAt) {
      reasons.push(`wad expired at ${this.expiresAt.toISOString()}`)
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      reasons.push(`amount must be a positive number`)
    } else {
      if (amount > this.perTxCap) reasons.push(`exceeds per-tx cap ($${this.perTxCap})`)
      const todayAfter = this.todaySpentUsd() + amount
      if (todayAfter > this.dailyCap) {
        reasons.push(`would exceed daily cap ($${this.dailyCap}, spent today $${this.todaySpentUsd().toFixed(2)})`)
      }
    }
    if (!to || !isAddress(to)) {
      reasons.push(`invalid recipient address`)
    } else if (this.allowlist.length > 0 && !this.allowlist.includes(getAddress(to).toLowerCase())) {
      reasons.push(`recipient not on allowlist`)
    }
    return { ok: reasons.length === 0, reasons }
  }

  async pay({ to, amount }) {
    if (this._payInFlight) {
      throw new GripPolicyError("a payment is already in flight on this wad", ["concurrent pay()"])
    }
    const verdict = this.evaluate({ to, amount })
    if (!verdict.ok) {
      throw new GripPolicyError(`payment blocked: ${verdict.reasons.join(", ")}`, verdict.reasons)
    }

    this._payInFlight = true
    const entry = { amount, to: getAddress(to), hash: null, at: new Date(), status: "pending" }
    this._spent.push(entry)
    try {
      const result = await this.spendClient.transfer({ to, amount })
      entry.hash = result.hash
      entry.status = result.status
      entry.opHash = result.opHash
      entry.bootstrapTxHash = result.bootstrapped
      return {
        hash: result.hash,
        opHash: result.opHash,
        status: result.status,
        basescanUrl: result.basescanUrl,
        blockNumber: result.blockNumber,
        bootstrapTxHash: result.bootstrapped,
        paymaster: result.paymaster,
      }
    } catch (err) {
      entry.status = "failed"
      entry.error = err.message
      throw err
    } finally {
      this._payInFlight = false
    }
  }

  spent() {
    const today = this.todaySpentUsd()
    return {
      today: { used: today, cap: this.dailyCap, remaining: Math.max(0, this.dailyCap - today) },
      perTx: { cap: this.perTxCap },
      total: this._spent.length,
      lastTx: this._spent.at(-1) || null,
    }
  }

  toJSON() {
    return {
      agentId: this.agentId,
      address: this.address,
      mode: "smart",
      dailyCap: this.dailyCap,
      perTxCap: this.perTxCap,
      allowlist: this.allowlist,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
      ...this.spent(),
    }
  }
}
