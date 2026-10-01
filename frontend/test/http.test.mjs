import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { httpTestEnvironment } from './http-env.mjs'

const run = process.env.NARRATIVE_HTTP_TEST_RUN
const validRun = typeof run === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(run)
if (!validRun) throw new Error('Run npm run test:http to build an isolated mock-only server')
const testEnv = httpTestEnvironment(run)
const project = new URL(`../.next-http-tests/${run}/`, import.meta.url)

// Local-only Auth/REST simulation. No real account, credential, Google or Supabase.
const ownerEmail = 'researcher@example.com'
const secret = 'local-test-signing-secret'
function user(email, provider = 'google') {
  const linked = ['email-linked', 'email-linked-password'].includes(provider)
  return {
    id: email === ownerEmail ? '00000000-0000-0000-0000-000000000001' : '00000000-0000-0000-0000-000000000002',
    email, aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(),
    email_confirmed_at: new Date().toISOString(), app_metadata: { provider: linked ? 'email' : provider },
    identities: linked ? [{ provider: 'email', identity_data: { email } }, { provider: 'google', identity_data: { email, email_verified: true } }] : [{ provider, identity_data: { email, email_verified: true } }],
  }
}
function session(email, provider) {
  const u = user(email, provider)
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const method = ['email', 'email-linked-password'].includes(provider) ? 'password' : 'oauth'
  const body = Buffer.from(JSON.stringify({ ...u, sub: u.id, fixture_provider: provider, is_anonymous: false, session_id: '00000000-0000-0000-0000-000000000010', amr: [{ method, timestamp: now }], iat: now, exp: now + 3600 })).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return { access_token: `${header}.${body}.${signature}`, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: u }
}
function sessionCookie(email, provider = 'google') {
  return `sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(session(email, provider))).toString('base64url')}`
}
function verifiedUser(request) {
  const token = (request.headers.authorization || '').replace(/^Bearer /, '')
  const [header, payload, signature] = token.split('.')
  if (!signature || createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url') !== signature) return null
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  return user(claims.email, claims.fixture_provider)
}
async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

test('Next HTTP boundaries: anonymous/other/forged denied, owner allowed, PKCE callback checked', { timeout: 45000 }, async () => {
  await access(new URL('.next/BUILD_ID', project))
  let databaseAllowed = true
  let reads = 0
  let authCalls = 0
  let invalidTokens = 0
  const mock = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const path = new URL(request.url, 'http://localhost').pathname
    const u = verifiedUser(request)
    const json = (body, status = 200) => { response.statusCode = status; response.end(JSON.stringify(body)) }
    if (path === '/auth/v1/user') {
      authCalls++
      if (!u) invalidTokens++
      return u ? json(u) : json({ msg: 'invalid token' }, 401)
    }
    if (path === '/auth/v1/logout') return json({})
    if (path === '/auth/v1/token') {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      if (!body.code_verifier || !['owner-code', 'other-code', 'linked-code', 'password-code'].includes(body.auth_code)) return json({ msg: 'invalid code' }, 400)
      return json(session(body.auth_code === 'other-code' ? 'other@example.com' : ownerEmail, body.auth_code === 'linked-code' ? 'email-linked' : body.auth_code === 'password-code' ? 'email-linked-password' : 'google'))
    }
    if (path === '/rest/v1/rpc/is_research_owner') return json(databaseAllowed && u?.email === ownerEmail)
    if (path === '/rest/v1/causal_chains') {
      reads++
      assert.equal(u?.email, ownerEmail)
      const chain = {
        id: 'test-story', score: 50, depth: 1, created_at: new Date().toISOString(),
        trigger_events: { id: 'test-trigger', summary: 'PRIVATE_RESEARCH_SENTINEL', category: 'AI', news_articles: { title: 'Test news', source: 'Fixture', url: 'https://example.com/' } },
        chain_nodes: [{ id: 'test-node', step_number: 1, event_text: 'PRIVATE_RESEARCH_SENTINEL_DETAIL', reasoning: 'fixture', confidence_score: 0.5, sources: [] }],
      }
      return json(request.headers.accept?.includes('object') ? chain : [chain])
    }
    return json({ msg: 'unexpected endpoint' }, 404)
  })
  const mockPort = await listen(mock)
  const portReservation = createServer()
  const port = await listen(portReservation)
  await new Promise(resolve => portReservation.close(resolve))
  const origin = `http://localhost:${port}`
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: project,
    env: { ...testEnv, NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${mockPort}`, RESEARCH_SITE_URL: origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', b => { logs += b })
  child.stderr.on('data', b => { logs += b })
  const fetchPage = (path, cookie, options = {}) => fetch(`${origin}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {}, ...options })
  try {
    const deadline = Date.now() + 15000
    while (true) {
      try { await fetchPage('/login'); break } catch {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Next failed to start: ${logs}`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    const login = await fetchPage('/login')
    const loginHtml = await login.text()
    assert.equal(login.status, 200)
    assert.match(loginHtml, /Googleでログイン/)
    assert.ok(!loginHtml.includes(ownerEmail))
    const diagnosis = await fetchPage('/login?error=denied&reason=user_email_mismatch')
    assert.match(await diagnosis.text(), /Googleが返したメールアドレス/)
    const unknownReason = await fetchPage('/login?error=denied&reason=__proto__')
    assert.equal(unknownReason.status, 200)

    for (const cookie of [undefined, 'sb-localhost-auth-token=base64-invalid', sessionCookie('other@example.com'), sessionCookie(ownerEmail, 'email'), sessionCookie(ownerEmail, 'email-linked-password'), sessionCookie(ownerEmail, 'github')]) {
      for (const path of ['/', '/story/test-story']) {
        const response = await fetchPage(path, cookie)
        assert.ok([303, 307].includes(response.status), `${path}: ${response.status}`)
        assert.match(response.headers.get('location'), /^\/login/)
        assert.ok(!(await response.text()).includes('PRIVATE_RESEARCH_SENTINEL'))
      }
    }
    assert.equal(reads, 0)
    const ownerCookie = sessionCookie(ownerEmail)
    for (const path of ['/', '/story/test-story']) {
      const response = await fetchPage(path, ownerCookie)
      assert.equal(response.status, 200, `Owner denied at ${path}: ${response.headers.get('location')}; mock auth calls=${authCalls}, invalid tokens=${invalidTokens}`)
      assert.match(await response.text(), /PRIVATE_RESEARCH_SENTINEL/)
      assert.match(response.headers.get('cache-control'), /private.*no-store/)
      assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store')
      assert.match(response.headers.get('x-robots-tag'), /noindex/)
    }
    // Regression: manual email signup must not block a subsequent Google OAuth login.
    for (const path of ['/', '/story/test-story']) {
      const linked = await fetchPage(path, sessionCookie(ownerEmail, 'email-linked'))
      assert.equal(linked.status, 200)
      assert.match(await linked.text(), /PRIVATE_RESEARCH_SENTINEL/)
    }
    const initialReads = reads
    databaseAllowed = false
    const blocked = await fetchPage('/', ownerCookie)
    assert.match(blocked.headers.get('location'), /configuration/)
    assert.equal(reads, initialReads)
    databaseAllowed = true

    // Forged JWT with owner's email cannot pass Auth verification.
    const forged = session(ownerEmail, 'google')
    forged.access_token = forged.access_token.slice(0, -5) + 'fake!'
    const rejected = await fetchPage('/', `sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(forged)).toString('base64url')}`)
    assert.match(rejected.headers.get('location'), /^\/login/)
    assert.equal(reads, initialReads)

    const missingCode = await fetchPage('/auth/callback?next=https://evil.example.com')
    assert.equal(missingCode.headers.get('location'), `${origin}/login?error=authentication`)
    const verifier = `sb-localhost-auth-token-code-verifier=base64-${Buffer.from(JSON.stringify('test-pkce-verifier')).toString('base64url')}`
    for (const [code, destination] of [['owner-code', '/'], ['linked-code', '/'], ['password-code', '/login?error=denied&reason=oauth_session_required'], ['other-code', '/login?error=denied&reason=user_email_mismatch']]) {
      const response = await fetchPage(`/auth/callback?code=${code}&next=https://evil.example.com`, verifier)
      assert.equal(response.headers.get('location'), `${origin}${destination}`)
      assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i)
    }

    // The actual Server Action creates a PKCE challenge and HttpOnly verifier cookie.
    const actionId = loginHtml.match(/name="(\$ACTION_ID_[^"]+)"/)[1]
    const form = new FormData()
    form.set(actionId, '')
    const oauth = await fetchPage('/login', undefined, { method: 'POST', headers: { Origin: origin }, body: form })
    const destination = new URL(oauth.headers.get('location'))
    assert.equal(destination.pathname, '/auth/v1/authorize')
    assert.equal(destination.searchParams.get('provider'), 'google')
    const callback = new URL(destination.searchParams.get('redirect_to'))
    assert.equal(callback.origin + callback.pathname, `${origin}/auth/callback`)
    assert.equal(destination.searchParams.get('code_challenge_method'), 's256')
    assert.ok(destination.searchParams.get('code_challenge'))
    assert.match(oauth.headers.get('set-cookie') || '', /HttpOnly/i)
    const flowCookies = oauth.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
    const flowId = callback.searchParams.get('sb_flow_id')
    const currentFlow = await fetchPage(`/auth/callback?code=owner-code${flowId ? `&sb_flow_id=${flowId}` : ''}`, flowCookies)
    assert.equal(currentFlow.headers.get('location'), `${origin}/`)
    const scopedVerifier = verifier.replace('-code-verifier=', '-flow-abcdefghijklmnop-code-verifier=')
    const scopedFlow = await fetchPage('/auth/callback?code=owner-code&sb_flow_id=abcdefghijklmnop', scopedVerifier)
    assert.equal(scopedFlow.headers.get('location'), `${origin}/`)
    const invalidFlow = await fetchPage('/auth/callback?code=owner-code&sb_flow_id=invalid', verifier)
    assert.equal(invalidFlow.headers.get('location'), `${origin}/login?error=authentication`)

    const ownerPage = await fetchPage('/', ownerCookie)
    const logoutAction = (await ownerPage.text()).match(/name="(\$ACTION_ID_[^"]+)"/)[1]
    const logoutForm = new FormData()
    logoutForm.set(logoutAction, '')
    const logout = await fetchPage('/', ownerCookie, { method: 'POST', headers: { Cookie: ownerCookie, Origin: origin }, body: logoutForm })
    assert.match(logout.headers.get('location'), /\/login$/)
    assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/i)
  } finally {
    const exited = child.exitCode === null ? once(child, 'exit') : Promise.resolve()
    child.kill('SIGTERM')
    await exited
    mock.closeAllConnections()
    await new Promise(resolve => mock.close(resolve))
  }
})

test('missing configuration fails closed without connecting to Supabase', { timeout: 30000 }, async () => {
  const reservation = createServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: project, stdio: 'ignore',
    env: { ...testEnv, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', RESEARCH_ALLOWED_EMAIL: '', RESEARCH_SITE_URL: origin },
  })
  try {
    const deadline = Date.now() + 15000
    while (true) {
      try { await fetch(`${origin}/login`); break } catch {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error('Next failed to start')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    for (const path of ['/', '/story/test-story']) {
      const response = await fetch(`${origin}${path}`, { redirect: 'manual' })
      assert.match(response.headers.get('location'), /\/login\?error=configuration$/)
      assert.ok(!(await response.text()).includes('PRIVATE_RESEARCH_SENTINEL'))
    }
    const callback = await fetch(`${origin}/auth/callback?code=owner-code`, { redirect: 'manual' })
    assert.equal(callback.status, 503)
  } finally {
    const exited = child.exitCode === null ? once(child, 'exit') : Promise.resolve()
    child.kill('SIGTERM')
    await exited
  }
})
