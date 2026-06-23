export function WildiIcon({ size = 16 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src="/wildi-coin.png"
      alt="Wildis"
      width={size}
      height={size}
      className="inline-block align-middle ml-0.5"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  )
}

/** "1 Wildi" / "Wildis" label */
export function wildiLabel(amount: number): string {
  return Math.abs(amount) === 1 ? 'Wildi' : 'Wildis'
}

/**
 * Format a Wildi amount for display.
 * - Whole numbers → no decimals (1.000 not 1.000,00)
 * - Otherwise → up to 2 decimal places, trailing zeros stripped (67,34 not 67,340)
 */
export function fmtWildi(n: number): string {
  if (Number.isInteger(n)) {
    return n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  // strip trailing zeros: maximumFractionDigits: 2 + minimumFractionDigits: 0
  return n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
