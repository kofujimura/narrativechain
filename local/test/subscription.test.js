import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { generationBackend, codexModelSettings } from '../api-client.js'
import { codexEnvironment, codexExecArgs, parseLoginStatus } from '../codex-client.js'
import { generateStories, validateStory } from '../generate.js'
import { runStoryCLI, parseStoryArgs } from '../story-cli.js'
import { createLocalServer } from '../server.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = fileURLToPath(new URL('fixtures/mock-codex.mjs', import.meta.url))
const content = '複数機関が医療業務支援用の日本語モデルを開発した。病院内で管理し、電子カルテとの接続を進める計画である。全国導入完了や受注確定ではない。'
const input = title => ({ type: 'text', name: title, content })
async function temp(task) { const dir = await mkdtemp(join(tmpdir(), 'narrative-subscription-test-')); try { return await task(dir) } finally { await rm(dir, { recursive: true, force: true }) } }
async function mock(dir, task) {
  const bin = join(dir, 'mock-codex.mjs'); await copyFile(fixture, bin); await chmod(bin, 0o700)
  const saved = process.env.NARRATIVE_CODEX_BIN
  process.env.NARRATIVE_CODEX_BIN = bin
  try { return await task(bin) } finally { if (saved === undefined) delete process.env.NARRATIVE_CODEX_BIN; else process.env.NARRATIVE_CODEX_BIN = saved }
}
test('default backend is subscription regardless of an API key; API is explicit', () => temp(async dir => {
  await writeFile(join(dir, '.env'), 'OPENAI_API_KEY=test-key\nOPENAI_MODEL=api-only-model\n')
  const saved = process.env.NARRATIVE_LLM_BACKEND; delete process.env.NARRATIVE_LLM_BACKEND
  try {
    assert.equal(await generationBackend(dir), 'codex')
    assert.equal(await generationBackend(dir, 'api'), 'api')
    await assert.rejects(generationBackend(dir, 'unknown'))
    assert.deepEqual(await codexModelSettings(dir), { filter: 'gpt-6.1-sol', generation: 'gpt-6.1-sol' })
    await writeFile(join(dir, '.env.local'), 'NARRATIVE_MODEL=codex-model\nNARRATIVE_FILTER_MODEL=filter-model\n')
    assert.deepEqual(await codexModelSettings(dir), { filter: 'filter-model', generation: 'codex-model' })
  } finally { if (saved !== undefined) process.env.NARRATIVE_LLM_BACKEND = saved }
}))
test('auth and exec settings fail closed and never inherit API credentials', () => {
  assert.equal(parseLoginStatus(0, 'Logged in using ChatGPT').ready, true)
  for (const [code, message] of [[0, 'Logged in using an API key'], [1, 'Not logged in'], [1, 'Logged in using ChatGPT']]) assert.equal(parseLoginStatus(code, message).ready, false)
  assert.deepEqual(codexEnvironment({ PATH: '/bin', HOME: '/home', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', OPENAI_BASE_URL: 'https://example.com' }), { PATH: '/bin', HOME: '/home' })
  const args = codexExecArgs('/tmp/space dir', '/tmp/schema.json', '/tmp/final.json')
  for (const value of ['forced_login_method="chatgpt"', 'model_provider="openai"', 'web_search="disabled"', 'read-only', '--ignore-user-config', 'shell_tool', 'multi_agent']) assert.ok(args.includes(value))
})
test('real child-process protocol generates story JSON+escaped HTML without API budget', () => temp(dir => mock(dir, async () => {
  const result = await generateStories({ root, dir, id: 'test', inputs: [input('医療モデル開発')] })
  assert.equal(result.backend, 'codex'); assert.equal(result.stories.length, 1)
  assert.equal(result.stories[0].chain.length, 1)
  const packet = JSON.parse(await readFile(join(dir, 'story-1.json'), 'utf8'))
  assert.equal(packet.schema_version, 'narrative-investigation/v1'); assert.equal(packet.story.facts[0].text, content)
  const invocation = JSON.parse(await readFile(join(dir, 'codex/story-1/agent-final.json.invocation.json'), 'utf8'))
  assert.equal(invocation.inheritedSecret, false)
  assert.ok(invocation.args.includes('forced_login_method="chatgpt"'))
  assert.match(await readFile(join(dir, 'codex/filter/events.jsonl'), 'utf8'), /input_tokens/)
  assert.match(await readFile(join(dir, 'stories.html'), 'utf8'), /反証/)
  await assert.rejects(readFile(join(dir, 'llm-budget/ledger.json')), /ENOENT/)
})))
test('low-impact news invokes only the gate; duplicate inputs generate once', () => temp(dir => mock(dir, async () => {
  const low = join(dir, 'low'), duplicate = join(dir, 'duplicate'); await Promise.all([mkdir(low), mkdir(duplicate)])
  const result = await generateStories({ root, dir: low, id: 'test', inputs: [input('開催案内')] })
  assert.equal(result.stories.length, 0); assert.match(result.note, /該当なし/)
  await assert.rejects(readFile(join(low, 'codex/story-1/started.json')), /ENOENT/)
  const duplicates = await generateStories({ root, dir: duplicate, id: 'test', inputs: [input('医療モデル開発'), input('医療モデル開発')] })
  assert.equal(duplicates.stories.length, 1); assert.equal(duplicates.assessments.filter(a => a.decision === 'duplicate').length, 1)
})))
test('Codex failures and API-key login never fall back to API or publish HTML', () => temp(dir => mock(dir, async bin => {
  await assert.rejects(generateStories({ root, dir, id: 'test', inputs: [input('FAIL_CODEX')] }), /終了コード 9/)
  await assert.rejects(readFile(join(dir, 'stories.html')), /ENOENT/)
  const apiBin = join(dir, 'api-login.mjs'); await copyFile(bin, apiBin); await chmod(apiBin, 0o700); process.env.NARRATIVE_CODEX_BIN = apiBin
  await assert.rejects(generateStories({ root, dir, id: 'test-2', inputs: [input('医療モデル開発')] }), /ChatGPTログイン/)
  await assert.rejects(readFile(join(dir, 'codex/test-2/started.json')), /ENOENT/)
})))
test('direct Skill prepare/plan/render uses no child or API and returns safe HTML', () => temp(async dir => {
  const output = join(dir, 'out'), source = join(dir, 'news.html')
  await writeFile(source, `<title>医療モデル開発</title><article>${content}<script>injected()</script></article>`)
  const saved = process.env.NARRATIVE_CODEX_BIN; process.env.NARRATIVE_CODEX_BIN = '/missing/binary'
  try {
    await runStoryCLI(['--prepare', '--input', source, '--output', output], { log: () => {} })
    const request = JSON.parse(await readFile(join(output, 'filter-request.json'), 'utf8')), data = JSON.parse(request.input)
    await writeFile(join(output, 'filter-result.json'), JSON.stringify({ results: [{ id: 'a0', input_status: 'sufficient', kind: 'substantive_change', novelty: 2, magnitude: 2, reach: 2, evidence: 2,
      change: '開発', impact_path: '業務改善', reason: '具体的な成果', missing_information: '', evidence_quotes: [data[0].body.slice(0, 20)], duplicate_of: null }] }))
    const plan = await runStoryCLI(['--plan', '--output', output], { log: () => {} }); assert.equal(plan.length, 1)
    await writeFile(join(output, 'story-1-result.json'), JSON.stringify({ decision: 'story', confirmed_facts: [{ fact: '開発成果', fact_ids: ['F1'] }], chain: [{ event: '<script>evil()</script>', mechanism: '接続が必要', condition: '導入するなら', refutation: '既存設備で足りるなら', fact_ids: ['F1'] }], narrative: '<img src=x onerror=evil()> 未確認の仮説。', questions: [] }))
    const result = await runStoryCLI(['--render', '--output', output], { log: () => {} }); assert.equal(result.stories.length, 1)
    const html = await readFile(join(output, 'stories.html'), 'utf8'); assert.match(html, /&lt;script&gt;/); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('injected()'))
    await assert.rejects(runStoryCLI(['--prepare', '--input', source, '--output', output], { log: () => {} }), /EEXIST/)
  } finally { if (saved === undefined) delete process.env.NARRATIVE_CODEX_BIN; else process.env.NARRATIVE_CODEX_BIN = saved }
}))
test('CLI requires usage/cost authorization and validation rejects fabricated roots', async () => {
  assert.throws(() => parseStoryArgs(['--prepare', '--render', '--output', '/tmp/new']), /1工程/)
  assert.throws(() => parseStoryArgs(['--input', '--output', '/tmp/new']), /値が必要/)
  await assert.rejects(runStoryCLI(['--input', 'unused.html', '--output', '/tmp/new', '--backend', 'codex']), /ack-usage/)
  await assert.rejects(runStoryCLI(['--input', 'unused.html', '--output', '/tmp/new', '--backend', 'api']), /ack-api-cost/)
  assert.throws(() => validateStory({ decision: 'story', narrative: '仮説', confirmed_facts: [], chain: [{ fact_ids: ['UNKNOWN'] }], questions: [] }, [{ id: 'F1' }]), /根拠番号/)
})
test('Web subscription preflight rejects unsigned-in auth without running or API fallback', () => temp(async dir => {
  let calls = 0
  const app = await createLocalServer({ dataDir: dir, codexStatus: async () => ({ ready: false, message: 'ChatGPTログインが必要' }), generate: async () => { calls++ } })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}`
  try {
    const state = await (await fetch(base + '/api/bootstrap')).json()
    assert.equal(state.default_backend, 'codex'); assert.equal(state.codex.ready, false)
    const response = await fetch(base + '/api/generate', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Narrative-Token': state.token }, body: JSON.stringify({ consent: true, inputs: [input('医療')] }) })
    assert.equal(response.status, 409); assert.equal(calls, 0)
  } finally { await app.close() }
}))
