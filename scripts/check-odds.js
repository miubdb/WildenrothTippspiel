#!/usr/bin/env node
/**
 * Sanity-check script for the Poisson xG model.
 * Run with: node scripts/check-odds.js
 * No test framework required — exits non-zero if any assertion fails.
 */

const LEAGUE_HOME_XG = 1.20
const LEAGUE_AWAY_XG = 1.05
const HOUSE_MARGIN = 0.12
const XG_PRIOR = 4
const MIN_ODDS = 1.05
const MAX_ODDS = 100.0

// ---- core math (mirrors lib/odds.ts) ----

function bayesianRate(raw, leagueAvg, n) {
  return (n * raw + XG_PRIOR * leagueAvg) / ((n + XG_PRIOR) * leagueAvg)
}

function poisson(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

function buildScoreMatrix(homeXG, awayXG, maxGoals = 8) {
  const matrix = []
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = []
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = poisson(homeXG, h) * poisson(awayXG, a)
    }
  }
  return matrix
}

function toOdds(prob) {
  if (prob <= 0) return MAX_ODDS
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, Math.round(1 / (prob * (1 + HOUSE_MARGIN)) * 100) / 100))
}

function calcMarkets(homeXG, awayXG) {
  const matrix = buildScoreMatrix(homeXG, awayXG)
  let pHome = 0, pDraw = 0, pAway = 0, pOver35 = 0, pBtts = 0
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    const p = matrix[h][a]
    if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p
    if (h + a > 3) pOver35 += p
    if (h > 0 && a > 0) pBtts += p
  }
  return {
    pHome: Math.round(pHome * 1000) / 10,
    pDraw: Math.round(pDraw * 1000) / 10,
    pAway: Math.round(pAway * 1000) / 10,
    oddsHome: toOdds(pHome),
    oddsDraw: toOdds(pDraw),
    oddsAway: toOdds(pAway),
    oddsOver35: toOdds(pOver35),
    oddsBtts: toOdds(pBtts),
    pOver35: Math.round(pOver35 * 1000) / 10,
    pBtts: Math.round(pBtts * 1000) / 10,
  }
}

function matchXG(homeAtkAvg, homeAtkN, awayDefAvg, awayDefN, awayAtkAvg, awayAtkN, homeDefAvg, homeDefN) {
  const homeAtkRate = bayesianRate(homeAtkAvg, LEAGUE_HOME_XG, homeAtkN)
  const awayDefRate = bayesianRate(awayDefAvg, LEAGUE_HOME_XG, awayDefN)
  const awayAtkRate = bayesianRate(awayAtkAvg, LEAGUE_AWAY_XG, awayAtkN)
  const homeDefRate = bayesianRate(homeDefAvg, LEAGUE_AWAY_XG, homeDefN)
  return {
    homeXG: Math.max(0.20, LEAGUE_HOME_XG * homeAtkRate * awayDefRate),
    awayXG: Math.max(0.20, LEAGUE_AWAY_XG * awayAtkRate * homeDefRate),
  }
}

// ---- assertions ----

let failures = 0
function assert(label, condition, detail = '') {
  if (!condition) {
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`)
    failures++
  } else {
    console.log(`  pass  ${label}`)
  }
}

// ---- test cases ----

console.log('\n=== 1. Balanced average teams ===')
{
  const { homeXG, awayXG } = matchXG(
    LEAGUE_HOME_XG, 6, LEAGUE_HOME_XG, 6,
    LEAGUE_AWAY_XG, 6, LEAGUE_AWAY_XG, 6
  )
  const m = calcMarkets(homeXG, awayXG)
  console.log(`  homeXG=${homeXG.toFixed(2)} awayXG=${awayXG.toFixed(2)}`)
  console.log(`  1X2: ${m.oddsHome}/${m.oddsDraw}/${m.oddsAway}  O/U3.5: ${m.oddsOver35}  BTTS: ${m.oddsBtts}`)
  assert('avg team homeXG ≈ LEAGUE_HOME_XG', Math.abs(homeXG - LEAGUE_HOME_XG) < 0.01, `got ${homeXG.toFixed(3)}`)
  assert('avg team awayXG ≈ LEAGUE_AWAY_XG', Math.abs(awayXG - LEAGUE_AWAY_XG) < 0.01, `got ${awayXG.toFixed(3)}`)
  assert('BTTS Yes > 1.80 for average game', m.oddsBtts > 1.80, `got ${m.oddsBtts}`)
  assert('O/U 3.5 Over > 3.50 for average game', m.oddsOver35 > 3.50, `got ${m.oddsOver35}`)
  assert('1X2 home ≈ away for balanced game', Math.abs(m.pHome - m.pAway) < 8, `home=${m.pHome}% away=${m.pAway}%`)
}

console.log('\n=== 2. No data — pure prior ===')
{
  const { homeXG, awayXG } = matchXG(LEAGUE_HOME_XG, 0, LEAGUE_HOME_XG, 0, LEAGUE_AWAY_XG, 0, LEAGUE_AWAY_XG, 0)
  assert('no-data homeXG = LEAGUE_HOME_XG', Math.abs(homeXG - LEAGUE_HOME_XG) < 0.001)
  assert('no-data awayXG = LEAGUE_AWAY_XG', Math.abs(awayXG - LEAGUE_AWAY_XG) < 0.001)
}

console.log('\n=== 3. Clear away favorite (Wildenroth scenario) ===')
{
  // Strong away team: scores 2.8 goals away (n=6), concedes 0.4 away (n=6)
  // Weak home team:   scores 0.7 at home (n=6), concedes 2.5 at home (n=6)
  const { homeXG, awayXG } = matchXG(0.7, 6, 0.4, 6, 2.8, 6, 2.5, 6)
  const m = calcMarkets(homeXG, awayXG)
  console.log(`  homeXG=${homeXG.toFixed(2)} awayXG=${awayXG.toFixed(2)}`)
  console.log(`  1X2: ${m.oddsHome}/${m.oddsDraw}/${m.oddsAway}  O/U3.5: ${m.oddsOver35}  BTTS: ${m.oddsBtts}`)
  assert('away xG > home xG (clear away favorite)', awayXG > homeXG, `home=${homeXG.toFixed(2)} away=${awayXG.toFixed(2)}`)
  assert('away win more likely than home win', m.pAway > m.pHome, `away=${m.pAway}% home=${m.pHome}%`)
  assert('away team is clear favorite (>50% win prob)', m.pAway > 50, `${m.pAway}%`)
  assert('away odds meaningfully below home odds', m.oddsAway < m.oddsHome, `away=${m.oddsAway} home=${m.oddsHome}`)
}

console.log('\n=== 4. Clear home favorite ===')
{
  // Strong home team: scores 2.5 at home (n=6), concedes 0.5 at home (n=6)
  // Weak away team:   scores 0.6 away (n=6), concedes 2.2 away (n=6)
  const { homeXG, awayXG } = matchXG(2.5, 6, 2.2, 6, 0.6, 6, 0.5, 6)
  const m = calcMarkets(homeXG, awayXG)
  console.log(`  homeXG=${homeXG.toFixed(2)} awayXG=${awayXG.toFixed(2)}`)
  console.log(`  1X2: ${m.oddsHome}/${m.oddsDraw}/${m.oddsAway}`)
  assert('home win >50% for clear home favorite', m.pHome > 50, `${m.pHome}%`)
}

console.log('\n=== 5. Multiplicative amplification (mismatch > average) ===')
{
  const avgGame = matchXG(LEAGUE_HOME_XG, 6, LEAGUE_HOME_XG, 6, LEAGUE_AWAY_XG, 6, LEAGUE_AWAY_XG, 6)
  const mismatch = matchXG(2.0, 6, 2.0, 6, 2.0, 6, 2.0, 6)
  // Strong attacker vs poor defense should exceed the arithmetic mean prediction
  const arithmeticHomeXG = (2.0 + 2.0) / 2  // old model result for both at 2.0
  assert(
    'multiplicative homeXG > arithmetic avg for above-avg attack & defense',
    mismatch.homeXG > arithmeticHomeXG,
    `multiplicative=${mismatch.homeXG.toFixed(2)} arithmetic=${arithmeticHomeXG.toFixed(2)}`
  )
  assert(
    'mismatch game more goals than average game',
    mismatch.homeXG + mismatch.awayXG > avgGame.homeXG + avgGame.awayXG,
    `mismatch=${(mismatch.homeXG + mismatch.awayXG).toFixed(2)} avg=${(avgGame.homeXG + avgGame.awayXG).toFixed(2)}`
  )
}

console.log('\n=== 6. Odds sanity — no arbitrage ===')
{
  const { homeXG, awayXG } = matchXG(1.5, 5, 1.2, 5, 1.2, 5, 1.0, 5)
  const m = calcMarkets(homeXG, awayXG)
  // Implied probabilities with margin should sum >1 (bookmaker overround)
  const impliedSum = 1/m.oddsHome + 1/m.oddsDraw + 1/m.oddsAway
  assert('1X2 implied prob sum > 1 (overround)', impliedSum > 1.0, `sum=${impliedSum.toFixed(3)}`)
  assert('1X2 implied prob sum ≤ 1.20', impliedSum <= 1.20, `sum=${impliedSum.toFixed(3)}`)
}

console.log('\n=== 7. BTTS / O/U differentiation across matchups ===')
{
  // Defensive game: both teams score little and concede little
  const defensive = matchXG(0.6, 5, 0.6, 5, 0.5, 5, 0.5, 5)
  const md = calcMarkets(defensive.homeXG, defensive.awayXG)
  // Offensive game: both teams score lots and concede lots
  const offensive = matchXG(2.2, 5, 2.2, 5, 2.0, 5, 2.0, 5)
  const mo = calcMarkets(offensive.homeXG, offensive.awayXG)
  console.log(`  Defensive game: O3.5=${md.oddsOver35} BTTS=${md.oddsBtts}`)
  console.log(`  Offensive game: O3.5=${mo.oddsOver35} BTTS=${mo.oddsBtts}`)
  assert('O/U 3.5 Over meaningfully shorter for offensive game', mo.oddsOver35 < md.oddsOver35 - 1.0,
    `offensive=${mo.oddsOver35} defensive=${md.oddsOver35}`)
  assert('BTTS Yes shorter for offensive than defensive game', mo.oddsBtts < md.oddsBtts,
    `offensive=${mo.oddsBtts} defensive=${md.oddsBtts}`)
}

// ---- result ----

console.log()
if (failures === 0) {
  console.log(`✓ All checks passed`)
} else {
  console.error(`✗ ${failures} check(s) failed`)
  process.exit(1)
}
