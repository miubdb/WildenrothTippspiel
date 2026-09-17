/**
 * Candidate study for the goalscorer PRICING layer.
 *
 * The probability model is not touched by any of this. `prob_score` and
 * `playerXG` stay exactly as computed; this only asks how the fair odds derived
 * from them should be presented as an offered price.
 *
 * Why a pricing layer is needed at all: the corrected probability model prices
 * the long tail honestly, and honestly means very long — 15 of 21 Wildenroth I
 * players above 30, half of them above 50. Spieltag 1-7 never showed anything
 * above 30 because the old model simply hid those players. Offering them (the
 * product decision) at their raw fair price would make Spieltag 8 look like a
 * different game from Spieltag 1-7.
 *
 * Requirements every candidate must satisfy:
 *   - strictly increasing in the raw odds, so the player ORDER never flips
 *   - identity (or near-identity) at the short end: favourites keep their price
 *   - progressively stronger compression toward the long end
 *   - asymptotic to CAP, never reaching or exceeding it — so no pile-up
 *   - continuous and continuously differentiable, no steps or buckets
 *
 * Usage: node --experimental-strip-types scripts/run-goalscorer-pricing-study.mjs
 */

export interface PricingCandidate {
  key: string
  name: string
  formula: string
  /** raw fair odds → offered odds */
  price: (raw: number) => number
}

/**
 * All candidates share the same two anchors so they are comparable:
 *   MIN — the shortest price the book offers at all
 *   CAP — the asymptote; the offered price approaches but never reaches it
 */
export function buildCandidates(MIN = 1.2, CAP = 30): PricingCandidate[] {
  const S = CAP - MIN

  return [
    {
      key: 'harmonic',
      name: 'A — Harmonische (Möbius-)Kompression',
      formula: `o = MIN + S · x/(x + S),  x = r − MIN,  S = CAP − MIN = ${S}`,
      // Slope at r = MIN is exactly 1, so the very shortest prices are untouched,
      // but the bend sets in immediately and the middle of the market is pulled
      // in hard. Never reaches CAP.
      price: (r) => {
        const x = Math.max(0, r - MIN)
        return MIN + (S * x) / (x + S)
      },
    },
    {
      key: 'exp',
      name: 'B — Exponentielle Sättigung ab MIN',
      formula: `o = CAP − S · exp(−x/S),  x = r − MIN,  S = ${S}`,
      // o(MIN) = MIN and o'(MIN) = 1 exactly: identity slope at the bottom, with
      // the compression growing smoothly. Gentler in the middle than A.
      price: (r) => {
        const x = Math.max(0, r - MIN)
        return CAP - S * Math.exp(-x / S)
      },
    },
    {
      key: 'log',
      name: 'D — Beschränkte logarithmische Kompression',
      formula: `o = CAP − S/(1 + ln(1 + x/S)),  x = r − MIN,  S = ${S}`,
      // Also o(MIN) = MIN with slope 1, but the logarithm flattens so fast that
      // the whole long end collapses into a narrow band.
      price: (r) => {
        const x = Math.max(0, r - MIN)
        return CAP - S / (1 + Math.log1p(x / S))
      },
    },
    ...[5, 6, 8].map((T) => ({
      key: `hyb${T}`,
      name: `E${T} — Stückweise: identisch bis ${T}, darüber harmonische Sättigung`,
      formula: `o = r für r ≤ ${T};  o = CAP − D/(1 + (r−${T})/D), D = CAP−${T} darüber`,
      // Same C¹ join as C, but the upper branch decays like 1/x instead of
      // exp(−x). That matters at the very long end: the exponential branch is
      // within 0.5 of CAP from raw ≈ 100 onward, so a 100/1 and a 460/1 player
      // get the same price — exactly the pile-up this whole exercise is meant to
      // avoid, just moved from 30 to 29.9. The harmonic branch still separates
      // them (25.1 vs 28.8).
      price: (r: number) => {
        if (r <= T) return r
        const D = CAP - T
        return CAP - D / (1 + (r - T) / D)
      },
    })),
    ...[5, 6, 8].map((T) => ({
      key: `piecewise${T}`,
      name: `C${T} — Stückweise: identisch bis ${T}, darüber exponentielle Sättigung`,
      formula: `o = r für r ≤ ${T};  o = CAP − (CAP−${T})·exp(−(r−${T})/(CAP−${T})) darüber`,
      // C¹-continuous by construction: at r = T the two branches agree in value
      // AND in slope (both 1), so there is no kink a bettor could notice. Below T
      // nothing changes at all, which is what "don't touch the favourites"
      // literally means.
      price: (r: number) => {
        if (r <= T) return r
        const D = CAP - T
        return CAP - D * Math.exp(-(r - T) / D)
      },
    })),
  ]
}

/** Fair odds from a probability, before any compression. */
export const fairOdds = (prob: number, margin: number) =>
  prob > 0 ? 1 / (prob * (1 + margin)) : Infinity

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export function describe(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  return {
    n: s.length,
    p10: quantile(s, 0.10), p25: quantile(s, 0.25), median: quantile(s, 0.50),
    p75: quantile(s, 0.75), p90: quantile(s, 0.90), max: s[s.length - 1] ?? NaN,
    over30: s.filter((v) => v >= 29.995).length,
    over50: s.filter((v) => v >= 50).length,
  }
}

/** Strictly-increasing check on a dense grid — the order-preservation guarantee. */
export function isStrictlyIncreasing(f: (r: number) => number, from = 1.2, to = 400, step = 0.01): boolean {
  let prev = -Infinity
  for (let r = from; r <= to; r += step) {
    const v = f(r)
    if (!(v > prev)) return false
    prev = v
  }
  return true
}
