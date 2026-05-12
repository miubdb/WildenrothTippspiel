#!/usr/bin/env node
/**
 * Sanity-check script for the Poisson xG model.
 * Run with: node scripts/check-odds.js
 * Exits non-zero if any assertion fails.
 */

const LEAGUE_HOME_XG = 1.25
const LEAGUE_AWAY_XG = 1.10
const HOUSE_MARGIN = 0.12
const XG_PRIOR = 6
const MIN_ODDS = 1.05
const MAX_ODDS = 100.0

// ---- core math (mirrors lib/odds.ts) ----

function bayesianXG(raw, leagueAvg, n) {
  return (n * raw + XG_PRIOR * leagueAvg) / (n + XG_PRIOR)
}

function poisson(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

function buildScoreMatrix(homeXG, awayXG, maxGoals = 8) {
  const m = []
  for (let h = 0; h <= maxGoals; h++) {
    m[h] = []
    for (let a = 0; a <= maxGoals; a++) m[h][a] = poisson(homeXG, h) * poisson(awayXG, a)
  }
  return m
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
    oddsHome: toOdds(pHome), oddsDraw: toOdds(pDraw), oddsAway: toOdds(pAway),
    oddsOver35: toOdds(pOver35), oddsBtts: toOdds(pBtts),
    pOver35: Math.round(pOver35 * 1000) / 10,
    pBtts: Math.round(pBtts * 1000) / 10,
  }
}

/** Geometric-mean raw xG, then single Bayesian shrinkage */
function matchXG(homeAtkAvg, homeAtkN, awayDefAvg, awayDefN, awayAtkAvg, awayAtkN, homeDefAvg, homeDefN) {
  const rawH = Math.sqrt(homeAtkAvg * awayDefAvg)
  const rawA = Math.sqrt(awayAtkAvg * homeDefAvg)
  const nH = (homeAtkN + awayDefN) / 2
  const nA = (awayAtkN + homeDefN) / 2
  return {
    homeXG: Math.max(0.25, bayesianXG(rawH, LEAGUE_HOME_XG, nH)),
    awayXG: Math.max(0.25, bayesianXG(rawA, LEAGUE_AWAY_XG, nA)),
  }
}

// ---- assertions ----

let failures = 0
function assert(label, condition, detail = '') {
  if (!condition) { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures++ }
  else console.log(`  pass  ${label}`)
}

// ---- test cases ----

console.log('\n=== 1. Average teams (no data) ===')
{
  const m = calcMarkets(LEAGUE_HOME_XG, LEAGUE_AWAY_XG)
  console.log(`  1X2: ${m.oddsHome}/${m.oddsDraw}/${m.oddsAway}  O/U3.5: ${m.oddsOver35}  BTTS: ${m.oddsBtts}  pDraw: ${m.pDraw}%`)
  assert('BTTS Yes > 1.75 for average game', m.oddsBtts > 1.75, `got ${m.oddsBtts}`)
  assert('O/U 3.5 Over > 3.50 for average game', m.oddsOver35 > 3.50, `got ${m.oddsOver35}`)
  assert('Draw probability 22–32% for balanced game', m.pDraw >= 22 && m.pDraw <= 32, `${m.pDraw}%`)
  assert('Home odds < 3.00 for slight home advantage', m.oddsHome < 3.00, `got ${m.oddsHome}`)
}

console.log('\n=== 2. No data → pure prior ===')
{
  const { homeXG, awayXG } = matchXG(LEAGUE_HOME_XG, 0, LEAGUE_HOME_XG, 0, LEAGUE_AWAY_XG, 0, LEAGUE_AWAY_XG, 0)
  assert('no-data homeXG = LEAGUE_HOME_XG', Math.abs(homeXG - LEAGUE_HOME_XG) < 0.001, `got ${homeXG}`)
  assert('no-data awayXG = LEAGUE_AWAY_XG', Math.abs(awayXG - LEAGUE_AWAY_XG) < 0.001, `got ${awayXG}`)
}

console.log('\n=== 3. Clear away favourite (Wildenroth scenario) ===')
{
  // Strong away team vs weak home team (typical for top-vs-bottom)
  const { homeXG, awayXG } = matchXG(0.8, 5, 0.4, 5, 2.5, 5, 2.0, 5)
  const m = calcMarkets(homeXG, awayXG)
  console.log(`  homeXG=${homeXG.toFixed(2)} awayXG=${awayXG.toFixed(2)}`)
  console.log(`  1X2: ${m.oddsHome}/${m.oddsDraw}/${m.oddsAway}  O/U3.5: ${m.oddsOver35}  BTTS: ${m.oddsBtts}`)
  assert('away win probability >45%', m.pAway > 45, `${m.pAway}%`)
  assert('away odds < home odds (away is favourite)', m.oddsAway < m.oddsHome, `away=${m.oddsAway} home=${m.oddsHome}`)
  assert('O/U 3.5 Over NOT extreme (> 2.20)', m.oddsOver35 > 2.20, `got ${m.oddsOver35}`)
  assert('BTTS Yes NOT extreme (> 1.50)', m.oddsBtts > 1.50, `got ${m.oddsBtts}`)
  assert('Draw probability still meaningful (> 15%)', m.pDraw > 15, `${m.pDraw}%`)
  assert('Draw odds NOT absurd (< 10.00)', m.oddsDraw < 10.00, `got ${m.oddsDraw}`)
}

console.log('\n=== 4. Balanced near-home-advantage game (Fürstenfeldbruck scenario) ===')
{
  const { homeXG, awayXG } = matchXG(1.3, 6, 1.3, 6, 1.2, 6, 1.3, 6)
  const m = calcMarkets(homeXG, awayXG)
  console.log(`  homeXG=${homeXG.toFixed(2)} awayXG=${awayXG.toFixed(2)}`)
  console.log(`  1X2: ${m.oddsHome}/${m.oddsDraw}/${m.oddsAway}  pDraw: ${m.pDraw}%`)
  assert('Draw > 25% for balanced game', m.pDraw > 25, `${m.pDraw}%`)
  assert('Draw odds < 4.50 for balanced game', m.oddsDraw < 4.50, `got ${m.oddsDraw}`)
  assert('Home and away not wildly apart', Math.abs(m.pHome - m.pAway) < 15, `home=${m.pHome}% away=${m.pAway}%`)
}

console.log('\n=== 5. O/U and BTTS NOT hitting minimum for any realistic matchup ===')
{
  // Even the most extreme realistic matchup should NOT floor O/U 3.5 or BTTS
  const { homeXG, awayXG } = matchXG(2.5, 6, 2.5, 6, 2.5, 6, 2.5, 6)
  const m = calcMarkets(homeXG, awayXG)
  console.log(`  Extreme game: homeXG=${homeXG.toFixed(2)} awayXG=${awayXG.toFixed(2)}`)
  console.log(`  O/U3.5: ${m.oddsOver35}  BTTS: ${m.oddsBtts}`)
  assert('O/U 3.5 > 1.30 even for very extreme game', m.oddsOver35 > 1.30, `got ${m.oddsOver35}`)
  assert('BTTS Yes > 1.10 even for very extreme game', m.oddsBtts > 1.10, `got ${m.oddsBtts}`)
}

console.log('\n=== 6. Geometric mean: mismatch effect preserved ===')
{
  const balanced = matchXG(LEAGUE_HOME_XG, 6, LEAGUE_HOME_XG, 6, LEAGUE_AWAY_XG, 6, LEAGUE_AWAY_XG, 6)
  const mismatch = matchXG(0.8, 6, 0.5, 6, 2.2, 6, 2.0, 6)
  assert('mismatch away xG > balanced away xG (quality spreads)', mismatch.awayXG > balanced.awayXG,
    `mismatch=${mismatch.awayXG.toFixed(2)} balanced=${balanced.awayXG.toFixed(2)}`)
  assert('mismatch home xG < balanced home xG (weak home is weaker)', mismatch.homeXG < balanced.homeXG,
    `mismatch=${mismatch.homeXG.toFixed(2)} balanced=${balanced.homeXG.toFixed(2)}`)
}

console.log('\n=== 7. No arbitrage ===')
{
  const m = calcMarkets(1.40, 1.20)
  const impliedSum = 1/m.oddsHome + 1/m.oddsDraw + 1/m.oddsAway
  assert('1X2 implied sum > 1.0 (overround)', impliedSum > 1.0, `sum=${impliedSum.toFixed(3)}`)
  assert('1X2 implied sum ≤ 1.20', impliedSum <= 1.20, `sum=${impliedSum.toFixed(3)}`)
}

console.log()
if (failures === 0) console.log('✓ All checks passed')
else { console.error(`✗ ${failures} check(s) failed`); process.exit(1) }
