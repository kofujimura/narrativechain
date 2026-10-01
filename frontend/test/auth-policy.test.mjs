import test from 'node:test'
import assert from 'node:assert/strict'
import { isResearchOwner, configuredSiteOrigin, researchOwnerDenialReason } from '../lib/auth-policy.mjs'
import { httpTestEnvironment } from './http-env.mjs'

const email = 'researcher@example.com'
const owner = {
  id: 'owner-id', email, email_confirmed_at: '2026-10-01T00:00:00Z',
  app_metadata: { provider: 'google' },
  identities: [{ provider: 'google', identity_data: { email, email_verified: true } }],
}
const claims = { sub: owner.id, role: 'authenticated', is_anonymous: false, session_id: '00000000-0000-0000-0000-000000000010', amr: [{ method: 'oauth', timestamp: 1790812800 }] }

test('only the configured Google-verified owner is accepted', () => {
  assert.equal(isResearchOwner(owner, email, claims), true)
  assert.equal(isResearchOwner(owner, ' RESEARCHER@EXAMPLE.COM ', claims), true)
  assert.equal(isResearchOwner(null, email, claims), false)
  assert.equal(isResearchOwner(owner, 'other@example.com', claims), false)
  for (const config of [undefined, '', '*', 'example.com', `${email},other@example.com`]) {
    assert.equal(isResearchOwner(owner, config, claims), false)
  }
})

test('unconfirmed, non-Google and forged metadata cannot authorize', () => {
  for (const patch of [
    { id: '' }, { email: 'other@example.com' }, { email_confirmed_at: null },
    { identities: [] },
    { identities: [{ provider: 'email', identity_data: { email, email_verified: true } }] },
    { identities: [{ provider: 'google', identity_data: { email, email_verified: false } }] },
    { identities: [{ provider: 'google', identity_data: { email, email_verified: 'true' } }] },
    { identities: [{ provider: 'google', identity_data: { email: 'other@example.com', email_verified: true } }] },
    { identities: [...owner.identities, { provider: 'github', identity_data: { email, email_verified: true } }] },
  ]) assert.equal(isResearchOwner({ ...owner, ...patch, user_metadata: { email, provider: 'google' } }, email, claims), false)
  assert.equal(isResearchOwner({ ...owner, identities: [], app_metadata: { provider: 'google', providers: ['google'] } }, email, claims), false)
})

test('email-created owner can use Google OAuth, but linked Google ID alone cannot authorize email login', () => {
  const linked = { ...owner, app_metadata: { provider: 'email', providers: ['email', 'google'] }, identities: [...owner.identities, { provider: 'email', identity_data: { email } }] }
  assert.equal(isResearchOwner(linked, email, claims), true)
  assert.equal(isResearchOwner({ ...linked, app_metadata: {} }, email, claims), true)
  for (const method of ['password', 'otp', 'magiclink', 'invite', 'recovery', 'email/signup', 'anonymous', 'sso/saml']) {
    assert.equal(isResearchOwner(linked, email, { ...claims, amr: [{ method }] }), false)
    assert.equal(isResearchOwner(linked, email, { ...claims, amr: [...claims.amr, { method }] }), false)
  }
  for (const patch of [
    { sub: 'other-id' }, { role: 'anon' }, { is_anonymous: true }, { is_anonymous: 'false' },
    { session_id: null }, { session_id: 'bad-session' }, { amr: undefined }, { amr: {} }, { amr: [] },
    { amr: [{ method: 'oauth', provider: 'github' }] }, { amr: [null] },
  ]) assert.equal(isResearchOwner(linked, email, { ...claims, ...patch }), false)
  assert.equal(isResearchOwner(linked, email, undefined), false)
  assert.equal(isResearchOwner(linked, email, { ...claims, amr: [...claims.amr, { method: 'totp' }, { method: 'token_refresh' }] }), true)
})

test('denial diagnostics contain fixed reasons only, never account data', () => {
  assert.equal(researchOwnerDenialReason(owner, email, claims), null)
  assert.equal(researchOwnerDenialReason({ ...owner, email: 'different@example.com' }, email, claims), 'user_email_mismatch')
  assert.equal(researchOwnerDenialReason({ ...owner, app_metadata: { provider: 'email' } }, email, claims), null)
  assert.equal(researchOwnerDenialReason({ ...owner, identities: [] }, email, claims), 'google_identity_missing')
  assert.equal(researchOwnerDenialReason({ ...owner, identities: [{ provider: 'google', identity_data: { email, email_verified: false } }] }, email, claims), 'google_identity_email_unverified')
  assert.equal(researchOwnerDenialReason(owner, email, { ...claims, amr: [{ method: 'password' }] }), 'oauth_session_required')
  assert.equal(researchOwnerDenialReason(owner, email, null), 'session_claims_invalid')
})

test('redirect origin is fixed configuration, HTTPS or loopback only', () => {
  assert.equal(configuredSiteOrigin('https://research.example.com/'), 'https://research.example.com')
  assert.equal(configuredSiteOrigin('http://localhost:3000'), 'http://localhost:3000')
  assert.equal(configuredSiteOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000')
  for (const value of [undefined, '', '//evil.example.com', 'http://evil.example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?next=evil', 'https://example.com/#fragment']) {
    assert.throws(() => configuredSiteOrigin(value))
  }
})

test('HTTP harness discards real credentials and fixes all auth settings', () => {
  const run = '00000000-0000-0000-0000-000000000001'
  const env = httpTestEnvironment(run, {
    PATH: '/test/bin', HOME: '/test/home',
    NEXT_PUBLIC_SUPABASE_URL: 'https://real-project.example.com',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'real-key', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'real-legacy-key',
    RESEARCH_ALLOWED_EMAIL: 'private@example.com', RESEARCH_SITE_URL: 'https://real.example.com',
    SUPABASE_SERVICE_ROLE_KEY: 'secret', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--inspect',
  })
  assert.equal(env.PATH, '/test/bin')
  assert.equal(env.NARRATIVE_HTTP_TEST_RUN, run)
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://localhost:9')
  assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'local-test-publishable')
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, '')
  assert.equal(env.RESEARCH_ALLOWED_EMAIL, email)
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS']) assert.equal(env[name], undefined)
})
