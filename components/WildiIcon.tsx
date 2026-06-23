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

/** Format an amount with label and optional singular/plural */
export function wildiLabel(amount: number): string {
  return Math.abs(amount) === 1 ? 'Wildi' : 'Wildis'
}
