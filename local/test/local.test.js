import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import http from 'node:http'
import { publicIPv4, checkURL, htmlToNews, normalizeInputs } from '../input.js'
import { ratio, escapeHTML, safeLink, renderReport } from '../report.js'
import { investigate, validatePacket, codexArgs } from '../research-cli.js'
import { createLocalServer } from '../server.js'
const packet = { schema_version: 'narrative-investigation/v1', story: { narrative: 'テスト用の未検証な物語です。', chain: [], facts: [] } }
test('SSRF: reject private, loopback, reserved, metadata, encoded and non-HTTP URLs', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.5', '172.16.2.3', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1']) assert.equal(publicIPv4(ip), false)
  assert.equal(publicIPv4('8.8.8.8'), true)
  for (const url of ['file:///etc/passwd', 'http://localhost/', 'http://0x7f000001/', 'http://127.1/', 'https://user:pass@example.com/', 'http://example.com:4444/']) assert.throws(() => checkURL(url))
})
test('HTML extracts inert text and ignores script/style, without executing resources', () => {
  const result = htmlToNews('<title>A &amp; B</title><script>evil()</script><article><h1>News</h1><p>Useful &lt;text&gt; &#x65e5;</p><img src="http://127.0.0.1"></article>')
  assert.equal(result.title, 'A & B'); assert.match(result.body, /Useful <text> 日/); assert.doesNotMatch(result.body, /evil|127/)
})
test('multiple text/html/json inputs and limits', async () => {
  const value = '社会の供給制約を変える新しい発表です。具体的な技術と実証計画が公表されました。'
  const result = await normalizeInputs([{ type: 'text', content: value }, { type: 'json', content: JSON.stringify({ title: 'JSON', facts: [value] }) }, { type: 'html', content: `<article>${value}</article>` }])
  assert.equal(result.length, 3); assert.equal(result[1].title, 'JSON')
  await assert.rejects(normalizeInputs([])); await assert.rejects(normalizeInputs([{ type: 'text', content: 'short' }])); await assert.rejects(normalizeInputs(Array(7).fill({ type: 'text', content: value })))
})
test('financial ratios require same period/scope, evidence and explicit theme match', () => {
  const m = { numerator: 20, denominator: 100, numerator_period: 'FY2025', denominator_period: 'FY2025', numerator_scope: '連結', denominator_scope: '連結', unit: '百万円', theme_match: true, evidence_urls: ['https://example.com/ir'] }
  assert.equal(ratio(m), 20)
  for (const patch of [{ numerator: null }, { numerator: 120 }, { denominator: 0 }, { theme_match: false }, { denominator_period: 'FY2024' }, { numerator_scope: '子会社' }, { evidence_urls: [] }]) assert.equal(ratio({ ...m, ...patch }), null)
})
test('inert HTML and links cannot execute source/model markup', () => {
  assert.equal(safeLink('javascript:alert(1)'), ''); assert.equal(safeLink('data:text/html,hello'), '')
  assert.equal(escapeHTML('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;')
})
test('CLI packet validation and sandbox arguments', () => {
  validatePacket(packet); assert.throws(() => validatePacket({ story: { narrative: 'x' } }))
  const args = codexArgs('/tmp/space path', '/tmp/schema.json', '/tmp/result.json')
  assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('shell_tool')); assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'))
})
test('standalone CLI workflow demo writes JSON+safe HTML and refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narrative-cli-test-'))
  try {
    const report = await investigate({ packet, outputDir: dir, demo: true })
    assert.match(report.summary, /架空/); assert.equal(ratio(report.candidates[0].theme_purity), null)
    report.summary = '<script>bad()</script>'
    assert.ok(renderReport(report).includes('&lt;script&gt;'))
    assert.match(await readFile(join(dir, 'report.html'), 'utf8'), /デモ調査/)
    await assert.rejects(investigate({ packet, outputDir: dir, demo: true }), /使用済み/)
    await assert.rejects(investigate({ packet, outputDir: join(dir, 'no-consent') }), /ack-usage/)
  } finally { await rm(dir, { recursive: true }) }
})
test('localhost API: CSRF/Host protection, zero-story generation, persistence, research subprocess demo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narrative-server-test-'))
  const app = await createLocalServer({ dataDir: dir, generate: async () => ({ articles: [], assessments: [], stories: [], note: '該当なし' }) })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}`, b = await (await fetch(base + '/api/bootstrap')).json()
  const post = async (path, value) => fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Narrative-Token': b.token }, body: JSON.stringify(value) })
  const wait = async id => { for (let i = 0; i < 100; i++) { const j = await (await fetch(base + '/api/jobs/' + id)).json(); if (j.status !== 'running') return j; await new Promise(r => setTimeout(r, 20)) } throw Error('Timeout') }
  try {
    assert.equal((await fetch(base + '/api/generate', { method: 'POST' })).status, 403)
    const rebinding = await new Promise(resolve => { http.get(base, { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode) }) })
    assert.equal(rebinding, 403)
    assert.equal((await post('/api/generate', { inputs: [], consent: false })).status, 400)
    const generation = await post('/api/generate', { inputs: [{ type: 'text', content: 'test' }], consent: true })
    // On fresh checkouts without a key, the endpoint correctly refuses paid mode.
    if (generation.status === 202) { const j = await wait((await generation.json()).id); assert.equal(j.status, 'complete'); assert.deepEqual(j.result.stories, []) }
    else assert.equal(generation.status, 409)
    if (b.samples.length) {
      const p = await (await fetch(base + `/api/packet?job=samples&story=${b.samples[0].id}`)).json(); validatePacket(p)
      assert.equal((await post('/api/investigate', { sourceJobId: 'samples', storyId: b.samples[0].id })).status, 400)
      const started = await (await post('/api/investigate', { sourceJobId: 'samples', storyId: b.samples[0].id, demo: true })).json()
      const result = await wait(started.id); assert.equal(result.status, 'complete'); assert.equal(result.result.demo, true)
      const html = await (await fetch(base + `/api/jobs/${started.id}/report`)).text(); assert.match(html, /デモ調査/); assert.ok(!html.includes('<script>'))
    }
    assert.equal((await fetch(base + '/api/jobs/../../.env')).status, 404)
  } finally { await app.close(); await rm(dir, { recursive: true }) }
})
