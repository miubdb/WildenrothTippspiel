import { cookies } from 'next/headers'

/** Schlüssel für den verschlüsselten Snapshot: kommt aus dem httpOnly-Cookie, das /recap-demo/unlock setzt. */
export const DEMO_KEY_COOKIE = 'rk'
export async function demoKey(): Promise<string | undefined> {
  return (await cookies()).get(DEMO_KEY_COOKIE)?.value
}
