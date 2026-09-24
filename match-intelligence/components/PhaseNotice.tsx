export function PhaseNotice({ feature, phase }: { feature: string; phase: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6">
      <p className="text-sm text-slate-300">
        <strong className="text-slate-100">{feature}</strong> ist noch nicht implementiert.
      </p>
      <p className="mt-1 text-xs text-slate-500">Geplant für {phase} der Implementierungsreihenfolge.</p>
    </div>
  )
}
