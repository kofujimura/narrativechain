import 'server-only'
import { redirect } from 'next/navigation'
import { researchOwnerDenialReason } from './auth-policy.mjs'
import { researchConfig } from './research-config'
import { createResearchClient } from './supabase-server'

// Call at the data boundary, not only in a layout or Proxy.
export async function requireResearchOwner() {
  let config
  try { config = researchConfig() } catch { redirect('/login?error=configuration') }
  const supabase = await createResearchClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  const { data: verified, error: claimsError } = await supabase.auth.getClaims()
  const denial = claimsError ? 'auth_session_verification_failed' : researchOwnerDenialReason(user, config.allowedEmail, verified?.claims)
  if (denial) {
    console.warn('Research authorization denied:', denial)
    redirect(`/login?error=denied&reason=${denial}`)
  }
  // Database configuration must ALSO agree. Missing migration or owner denies access.
  const { data: allowed, error: policyError } = await supabase.rpc('is_research_owner')
  if (policyError || allowed !== true) redirect('/login?error=configuration')
  return supabase
}
