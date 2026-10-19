import { ListSkeleton, Skeleton } from '@/components/ui'

export default function MeineWettenLoading() {
  return (
    <div className="space-y-4 px-4 py-4" aria-busy="true" role="status" aria-label="Wetten werden geladen">
      <Skeleton className="h-12 rounded-2xl" />
      <ListSkeleton rows={3} tall />
    </div>
  )
}
