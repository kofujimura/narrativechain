import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { researchConfig } from './research-config'
import { createResearchClient } from './supabase-server'
import { researchOwnerDenialReason } from './auth-policy.mjs'

export function privateJSON(body: unknown, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Vercel-CDN-Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  } })
}

export async function authorizeResearchAPI(request: Request) {
  let config
  try { config = researchConfig() } catch { return { response: privateJSON({ error: 'configuration' }, 503), client: null } }
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1]
  if (authorization && !token) return { response: privateJSON({ error: 'unauthorized' }, 401), client: null }
  // Cookie POSTs must come from this fixed site; Bearer CLI requests need no CORS.
  if (request.method === 'POST' && (!token || request.headers.has('origin')) && request.headers.get('origin') !== config.origin) {
    return { response: privateJSON({ error: 'origin_denied' }, 403), client: null }
  }
  const client = token ? createClient(config.url, config.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) : await createResearchClient()
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return { response: privateJSON({ error: 'unauthorized' }, 401), client: null }
  const { data: verified, error: claimsError } = await client.auth.getClaims(token)
  if (claimsError || researchOwnerDenialReason(user, config.allowedEmail, verified?.claims)) return { response: privateJSON({ error: 'forbidden' }, 403), client: null }
  const { data: allowed, error: policyError } = await client.rpc('is_research_owner')
  if (policyError) return { response: privateJSON({ error: 'configuration' }, 503), client: null }
  if (allowed !== true) return { response: privateJSON({ error: 'forbidden' }, 403), client: null }
  return { client, response: null }
}
