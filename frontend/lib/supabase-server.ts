import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { researchConfig } from './research-config'

export async function createResearchClient() {
  const { url, key, origin } = researchConfig()
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https://'), path: '/' },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          for (const { name, value, options } of values) cookieStore.set(name, value, options)
        } catch {
          // Server Components cannot write cookies. Proxy refreshes them first.
        }
      },
    },
  })
}
