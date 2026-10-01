import { NextResponse } from 'next/server'
import { researchConfig } from '../../../lib/research-config'
import { createResearchClient } from '../../../lib/supabase-server'
import { researchOwnerDenialReason } from '../../../lib/auth-policy.mjs'

export async function GET(request: Request) {
  // Never derive redirect destinations from Host, next, or forwarded headers.
  let config
  try { config = researchConfig() } catch {
    return new Response('Research site configuration is incomplete', { status: 503 })
  }
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.origin), 303)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }
  const params = new URL(request.url).searchParams
  const code = params.get('code')
  const flowId = params.get('sb_flow_id')
  if (!code) return finish('/login?error=authentication')
  const supabase = await createResearchClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code, flowId !== null ? { flowId } : undefined)
  if (error) return finish('/login?error=authentication')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  const { data: verified, error: claimsError } = await supabase.auth.getClaims()
  const denial = userError ? 'auth_user_verification_failed' : claimsError ? 'auth_session_verification_failed' : researchOwnerDenialReason(user, config.allowedEmail, verified?.claims)
  if (denial) {
    // Fixed enum only: never log a user, email, ID, OAuth code or token.
    console.warn('Research authorization denied:', denial)
    await supabase.auth.signOut({ scope: 'local' })
    return finish(`/login?error=denied&reason=${denial}`)
  }
  const { data: allowed, error: policyError } = await supabase.rpc('is_research_owner')
  if (policyError || allowed !== true) {
    await supabase.auth.signOut({ scope: 'local' })
    return finish('/login?error=configuration')
  }
  return finish('/')
}
