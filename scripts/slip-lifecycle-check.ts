/** Regression: annulment → cancellation → replacement Risky combo.
 * Never turn a remaining neutralized child of a cancelled parent into
 * a winning or still-used betting slip.
 */
import { isVisibleComboStatus, occupiesBettingSlot, visibleComboIds } from '@/lib/slipLifecycle'

let errors = 0
let checks = 0
function test(label: string, actual: boolean) {
  checks++
  if (!actual) errors++
  console.log(`${actual ? 'OK' : 'FAIL'}  ${label}`)
}

export function run(): number {
  const parents = [
    { id: 591, stake: 250, status: 'pending', risky: false, odds: 2.04 },
    { id: 592, stake: 250, status: 'pending', risky: false, odds: 1.68 },
    { id: 594, stake: 209.46, status: 'void', risky: true, odds: 39.13 },
    { id: 611, stake: 237.13, status: 'pending', risky: true, odds: 63.26 },
  ]
  const legs = [
    { combo_id: 594, status: 'neutralized' },
    { combo_id: 594, status: 'void' },
    { combo_id: 591, status: 'pending' },
    { combo_id: 592, status: 'pending' },
    { combo_id: 611, status: 'pending' },
  ]
  const visibleIds = visibleComboIds(parents)
  const visible = parents.filter(c => visibleIds.has(String(c.id)))
  const slots = visible.filter(c => occupiesBettingSlot(c.status))
  const shownLegs = legs.filter(l => visibleIds.has(String(l.combo_id)))
  test('Cancelled parent #594 is hidden despite neutralized child', !visibleIds.has('594'))
  test('No #594 leg leaks into display', !shownLegs.some(l => l.combo_id === 594))
  test('Only 3 valid slips remain', visible.length === 3)
  test('Only 3 occupied betting slots', slots.length === 3)
  test('Only 1 risky slot used', slots.filter(c => c.risky).length === 1)
  test('Total effective stake 737.13 WLD', Math.round(slots.reduce((n,c) => n+c.stake, 0)*100) === 73713)
  test('Settled net 0.00 WLD', !slots.some(c => c.status === 'won' || c.status === 'lost'))
  test('Void, missing and unknown parent status all excluded',
    !isVisibleComboStatus('void') && !isVisibleComboStatus(undefined) && !isVisibleComboStatus('other'))
  test('Fully refunded parent is displayable as neutralized but not an occupied slot',
    isVisibleComboStatus('neutralized') && !occupiesBettingSlot('neutralized'))
  test('Settled won/lost parent still uses a slot',
    occupiesBettingSlot('won') && occupiesBettingSlot('lost'))
  console.log(`${checks-errors}/${checks} tests passed`)
  return errors
}
