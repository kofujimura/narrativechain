import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { researchConfig } from './lib/research-config'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const noCache = () => {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    return response
  }
  let config
  try { config = researchConfig() } catch { return noCache() }
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: config.origin.startsWith('https://'), path: '/' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of values) response.cookies.set(name, value, options)
      },
    },
  })
  // Refresh only. Every protected page/API separately verifies identity + DB policy.
  await supabase.auth.getClaims()
  return noCache()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
