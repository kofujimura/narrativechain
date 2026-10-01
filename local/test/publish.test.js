import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm, lstat, readFile, access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loginPublisher, publishArtifact, siteOrigin, parsePublishArgs } from '../publish-cli.js'
import { storyPacket } from '../../frontend/test/artifact-fixtures.mjs'

test('publisher constrains site, mode and parents without contacting an API', () => {
  assert.equal(siteOrigin('https://research.example.com/'), 'https://research.example.com')
  for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com/path', 'https://example.com?token=secret']) assert.throws(() => siteOrigin(url))
  assert.throws(() => parsePublishArgs(['publish', '--site', 'https://example.com']))
  assert.throws(() => parsePublishArgs(['publish', '--site']))
})
test('CLI PKCE callback verifies owner before privately storing credentials; denial and timeout store nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narrative-pkce-test-'))
  let site, allowed = true, exchanged = 0, verified = 0
  const mock = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const json = (body, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)) }
    if (path === '/api/research/config') return json({ supabase_url: site, publishable_key: 'fixture-public-key' })
    if (path === '/auth/v1/token') {
      let raw = ''; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      assert.equal(body.auth_code, 'fixture-code')
      assert.ok(body.code_verifier.length >= 43)
      exchanged++
      return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user: { id: '00000000-0000-0000-0000-000000000001' } })
    }
    if (path === '/api/research/auth') {
      assert.equal(request.headers.authorization, 'Bearer fixture-access')
      verified++
      return json({ authenticated: allowed }, allowed ? 200 : 403)
    }
    return json({}, 404)
  })
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening')
  site = `http://localhost:${mock.address().port}`
  const callbacks = []
  const log = line => {
    if (!line.includes('/auth/v1/authorize')) return
    const url = new URL(line.split('\n')[1])
    assert.equal(url.searchParams.get('redirect_to'), 'http://localhost:4318/callback')
    assert.equal(url.searchParams.get('provider'), 'google')
    assert.equal(url.searchParams.get('code_challenge_method'), 's256')
    callbacks.push(fetch('http://localhost:4318/callback?code=fixture-code').then(r => r.status))
  }
  try {
    const authFile = join(dir, 'owner.json')
    await loginPublisher({ site, authFile, log, openBrowser: false, timeoutMs: 10000 })
    assert.equal(await callbacks.pop(), 200)
    assert.equal(exchanged, 1); assert.equal(verified, 1)
    assert.equal((await lstat(authFile)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(authFile, 'utf8')).site, site)
    allowed = false
    const deniedFile = join(dir, 'denied.json')
    await assert.rejects(loginPublisher({ site, authFile: deniedFile, log, openBrowser: false, timeoutMs: 10000 }), /HTTP 403/)
    assert.equal(await callbacks.pop(), 403)
    await assert.rejects(access(deniedFile), { code: 'ENOENT' })
    const timeoutFile = join(dir, 'timeout.json')
    await assert.rejects(loginPublisher({ site, authFile: timeoutFile, log: () => {}, openBrowser: false, timeoutMs: 20 }), /時間切れ/)
    await assert.rejects(access(timeoutFile), { code: 'ENOENT' })
  } finally { mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); await rm(dir, { recursive: true, force: true }) }
})
test('publisher uses owner bearer session, canonical JSON, safe result URL and no redirect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narrative-publisher-test-'))
  const input = join(dir, 'story.json'), authFile = join(dir, 'auth.json')
  const site = 'https://research.example.com', id = '00000000-0000-0000-0000-000000000099'
  const credentials = { site, session: { access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_at: Date.now() / 1000 + 3600 } }
  let calls = 0
  try {
    await writeFile(input, JSON.stringify(storyPacket()))
    await writeFile(authFile, JSON.stringify(credentials), { mode: 0o600 })
    const fetchImpl = async (url, options) => {
      calls++
      assert.equal(url, `${site}/api/research/documents`)
      assert.equal(options.headers.Authorization, 'Bearer fixture-token')
      assert.equal(options.redirect, 'manual')
      assert.ok(!JSON.parse(options.body).packet.exported_at)
      return Response.json({ id, path: `/research/${id}`, duplicate: false }, { status: 201 })
    }
    assert.deepEqual(await publishArtifact({ site, input, authFile, fetchImpl }), { id, url: `${site}/research/${id}`, duplicate: false })
    assert.equal(calls, 1)
    await assert.rejects(publishArtifact({ site: 'https://other.example.com', input, authFile, fetchImpl }), /登録先/)
    await assert.rejects(publishArtifact({ site, input, authFile, parentId: id, fetchImpl }), /parent/)
    assert.equal(calls, 1)
    await assert.rejects(publishArtifact({ site, input, authFile, fetchImpl: async () => Response.json({ id, path: 'https://evil.example.com/' }) }), /URL/)
    await assert.rejects(publishArtifact({ site, input, authFile, fetchImpl: async () => new Response('sensitive-body', { status: 403 }) }), /HTTP 403/)
    await chmod(authFile, 0o644)
    await assert.rejects(publishArtifact({ site, input, authFile, fetchImpl }), /0600/)
    assert.equal(calls, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
