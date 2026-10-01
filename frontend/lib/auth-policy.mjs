// Pure policy: receives getUser() data and getClaims() verified JWT claims.
// Never authorize with a cookie's user object or an unverified JWT decode.
/** @param {unknown} value */
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * @param {import('@supabase/supabase-js').User | null | undefined} user
 * @param {string | undefined} allowedEmail
 * @param {Record<string, unknown> | null | undefined} claims
 */
export function researchOwnerDenialReason(user, allowedEmail, claims) {
  const email = normalizeEmail(allowedEmail)
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) return 'owner_configuration_invalid'
  if (!user?.id) return 'verified_user_missing'
  if (normalizeEmail(user.email) !== email) return 'user_email_mismatch'
  if (!user.email_confirmed_at) return 'user_email_unconfirmed'
  const identities = Array.isArray(user.identities) ? user.identities : []
  const google = identities.filter(identity => identity.provider === 'google')
  if (google.length === 0) return 'google_identity_missing'
  const matching = google.filter(identity => normalizeEmail(identity.identity_data?.email) === email)
  if (matching.length === 0) return 'google_identity_email_mismatch'
  if (!matching.some(identity =>
    identity.identity_data?.email_verified === true
  )) return 'google_identity_email_unverified'
  // OAuth AMR does not name the provider. This Google-only site fails closed
  // for accounts with other providers, rather than guessing from the FIRST
  // signup provider in app_metadata (which may legitimately be "email").
  if (identities.some(identity => !['email', 'google'].includes(identity.provider))) return 'google_only_identity_required'
  if (!claims || claims.sub !== user.id || claims.role !== 'authenticated' || claims.is_anonymous !== false) return 'session_claims_invalid'
  if (typeof claims.session_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.session_id)) return 'session_claims_invalid'
  const amr = Array.isArray(claims.amr) ? claims.amr : []
  if (!amr.some(entry => entry?.method === 'oauth')) return 'oauth_session_required'
  const allowedMethods = ['oauth', 'totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code', 'token_refresh']
  if (amr.some(entry => !entry || !allowedMethods.includes(entry.method) || (entry.method === 'oauth' && entry.provider !== undefined && entry.provider !== 'google'))) return 'oauth_session_required'
  return null
}

/**
 * @param {import('@supabase/supabase-js').User | null | undefined} user
 * @param {string | undefined} allowedEmail
 * @param {Record<string, unknown> | null | undefined} claims
 */
export function isResearchOwner(user, allowedEmail, claims) {
  return researchOwnerDenialReason(user, allowedEmail, claims) === null
}

/** @param {string | undefined} value */
export function configuredSiteOrigin(value) {
  if (!value) throw new Error('Research site configuration is incomplete')
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Site URL must be an origin')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Site URL must use HTTPS (except loopback development)')
  }
  return url.origin
}
