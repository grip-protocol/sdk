// Self-test for examples/nano-wad.mjs — mirrors test/wad.test.js conventions,
// but exercises the feeless Nano (XNO) rail instead of the USDC smart-account rail.
// Run with: node --test examples/nano-wad.test.mjs  (or: node examples/nano-wad.test.mjs)

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NanoWad, NanoPolicyError, parseExpiry, NANO } from './nano-wad.mjs'

// Neutral placeholder Nano addresses (public-format, not controlled by anyone
// here) so the example runs offline with no wallet and no spendable funds.
const TEST_RECIPIENT = 'nano_3bs568q5f47ut6h7u59g5s5g4aktb9md8eq865fzunxxqmhdh7mzowk69tco'
const OTHER_ADDRESS = 'nano_1zt46nopzx67jy65mwkrp3xpc9z5fkahssz7cwsjaujtprgb7dbgg1zdik1b'

function freshAccount() {
  return { address: 'nano_1q3hqecaw15njt8myo5j9k9by0q6mq1q1q1q1q1q1q1q1q1q1q1q1j8p2ho' }
}

describe('NanoWad construction', () => {
  it('requires account with an address', () => {
    assert.throws(() => new NanoWad({}), /requires \{ account \}/)
    assert.throws(() => new NanoWad({ account: {} }), /requires \{ address \}/)
  })

  it('rejects negative caps', () => {
    assert.throws(() => new NanoWad({ account: freshAccount(), dailyCap: -1 }), /dailyCap must be a non-negative number/)
    assert.throws(() => new NanoWad({ account: freshAccount(), perTxCap: -5 }), /perTxCap must be a non-negative number/)
  })

  it('rejects allowlist with invalid Nano addresses', () => {
    assert.throws(
      () => new NanoWad({ account: freshAccount(), allowlist: ['not-an-address'] }),
      /invalid Nano address/,
    )
  })

  it('normalizes allowlist addresses to lowercase', () => {
    const wad = new NanoWad({ account: freshAccount(), allowlist: [TEST_RECIPIENT] })
    assert.equal(wad.allowlist[0], TEST_RECIPIENT.toLowerCase())
  })

  it('uses sensible defaults', () => {
    const wad = new NanoWad({ account: freshAccount() })
    assert.equal(wad.dailyCap, 100)
    assert.equal(wad.perTxCap, 20)
    assert.deepEqual(wad.allowlist, [])
    assert.equal(wad.expiresAt, null)
  })
})

describe('NanoWad.evaluate', () => {
  let wad
  beforeEach(() => {
    wad = new NanoWad({ account: freshAccount(), dailyCap: 25, perTxCap: 20 })
  })

  it('approves payments under both caps', () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
  })

  it('blocks payments over per-tx cap', () => {
    const r = wad.evaluate({ to: TEST_RECIPIENT, amount: 21 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(', '), /exceeds per-tx cap/)
  })

  it('blocks payments that would exceed daily cap', () => {
    const r = wad.evaluate({ to: TEST_RECIPIENT, amount: 26 })
    assert.equal(r.ok, false)
  })

  it('treats exact-equal-to-cap as allowed (boundary)', () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 20 }).ok, true)
  })

  it('rejects invalid recipient address', () => {
    const r = wad.evaluate({ to: 'not-a-nano-address', amount: 5 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(', '), /invalid recipient/)
  })

  it('rejects zero or negative amounts', () => {
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: 0 }).ok, false)
    assert.equal(wad.evaluate({ to: TEST_RECIPIENT, amount: -1 }).ok, false)
  })

  it('enforces allowlist when set', () => {
    const wadAllow = new NanoWad({ account: freshAccount(), allowlist: [TEST_RECIPIENT], perTxCap: 20, dailyCap: 100 })
    assert.equal(wadAllow.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
    const blocked = wadAllow.evaluate({ to: OTHER_ADDRESS, amount: 5 })
    assert.equal(blocked.ok, false)
    assert.match(blocked.reasons.join(', '), /not on allowlist/)
  })

  it('ignores allowlist when empty (open mode)', () => {
    const wadOpen = new NanoWad({ account: freshAccount(), allowlist: [] })
    assert.equal(wadOpen.evaluate({ to: TEST_RECIPIENT, amount: 5 }).ok, true)
    assert.equal(wadOpen.evaluate({ to: OTHER_ADDRESS, amount: 5 }).ok, true)
  })

  it('blocks all payments when wad is expired', () => {
    const expired = new NanoWad({ account: freshAccount(), expiresIn: new Date(Date.now() - 1000) })
    const r = expired.evaluate({ to: TEST_RECIPIENT, amount: 1 })
    assert.equal(r.ok, false)
    assert.match(r.reasons.join(', '), /expired/)
  })

  it('blocks everything when dailyCap is zero', () => {
    const zeroWad = new NanoWad({ account: freshAccount(), dailyCap: 0 })
    assert.equal(zeroWad.evaluate({ to: TEST_RECIPIENT, amount: 1 }).ok, false)
  })
})

describe('NanoWad.spent', () => {
  it('starts at zero', () => {
    const wad = new NanoWad({ account: freshAccount() })
    const s = wad.spent()
    assert.equal(s.today.used, 0)
    assert.equal(s.today.cap, 100)
    assert.equal(s.today.remaining, 100)
    assert.equal(s.total, 0)
    assert.equal(s.lastTx, null)
  })
})

describe('NanoWad.pay — feeless rail', () => {
  it('settles with zero fee and confirmed finality', async () => {
    const wad = new NanoWad({ account: freshAccount(), perTxCap: 20, dailyCap: 100 })
    const r = await wad.pay({ to: TEST_RECIPIENT, amount: 5 })
    assert.equal(r.status, 'confirmed')
    assert.equal(r.fee, 0)
    assert.equal(r.finality, 'confirmed')
    assert.ok(r.hash)
  })

  it('throws a policy error on a blocked payment', async () => {
    const wad = new NanoWad({ account: freshAccount(), perTxCap: 5, dailyCap: 20 })
    await assert.rejects(() => wad.pay({ to: TEST_RECIPIENT, amount: 10 }), NanoPolicyError)
  })

  it('reflects a confirmed payment in spent()', async () => {
    const wad = new NanoWad({ account: freshAccount(), perTxCap: 20, dailyCap: 100 })
    await wad.pay({ to: TEST_RECIPIENT, amount: 5 })
    const s = wad.spent()
    assert.equal(s.today.used, 5)
    assert.equal(s.total, 1)
  })
})

describe('parseExpiry', () => {
  it('returns null for null/undefined', () => {
    assert.equal(parseExpiry(null), null)
    assert.equal(parseExpiry(undefined), null)
  })
  it('passes Date through', () => {
    const d = new Date()
    assert.equal(parseExpiry(d), d)
  })
  it('parses days/hours/minutes', () => {
    assert.ok(parseExpiry('30d') instanceof Date)
    assert.ok(parseExpiry('12h') instanceof Date)
    assert.ok(parseExpiry('30m') instanceof Date)
  })
  it('rejects bad formats', () => {
    assert.throws(() => parseExpiry('30s'), /Invalid expiresIn/)
    assert.throws(() => parseExpiry('forever'), /Invalid expiresIn/)
  })
})

describe('Nano rail facts', () => {
  it('nano is feeless (feePerSend === 0)', () => {
    assert.equal(NANO.feePerSend, 0)
  })
})

describe('NanoPolicyError', () => {
  it('carries reasons array', () => {
    const err = new NanoPolicyError('blocked', ['reason a'])
    assert.equal(err.name, 'NanoPolicyError')
    assert.deepEqual(err.reasons, ['reason a'])
  })
})
