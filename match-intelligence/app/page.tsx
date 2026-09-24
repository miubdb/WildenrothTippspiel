import { redirect } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth'

export default async function RootPage() {
  const membership = await getCurrentMembership()
  redirect(membership ? '/dashboard' : '/login')
}
