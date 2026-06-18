import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const origin = request.headers.get('origin') ?? new URL(request.url).origin
  return NextResponse.redirect(new URL('/login', origin), { status: 303 })
}
