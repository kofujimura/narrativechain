import test from 'node:test'
import assert from 'node:assert/strict'
import { applyImpactGate, assessArticleImpact, filterTopArticles, parseResponseJSON, impactInputs } from '../../agents/importanceFilter.js'
import { analyzeEligibleArticles } from '../../agents/analysisPipeline.js'

const articles = [
  { id: 'notice', title: '開催案内', body: '会議の日時のみ。結論は未公表。', url: 'https://example.test/a' },
  { id: 'change', title: '重要な新決定', body: '供給制約を変える新設備の稼働が公表された。', url: 'https://example.test/b' },
]
function row(i, overrides = {}) { return { id: `a${i}`, kind: 'substantive_change', input_status: 'sufficient', novelty: 2,
  magnitude: 2, reach: 2, evidence: 2, change: '新決定', impact_path: '供給制約の緩和', reason: '具体的変化あり',
  missing_information: '', evidence_quotes: [articles[i].body], duplicate_of: null, ...overrides } }
const response = results => ({ results })
test('all-low-impact batch produces zero generation and persistence calls', async () => {
  let generation = 0, persistence = 0
  const filter = (items, topN) => filterTopArticles(items, topN, { request: async () => response([row(0, { kind: 'procedural_notice', novelty: 1, magnitude: 0, reach: 1 })]) })
  const result = await analyzeEligibleArticles([articles[0]], { filter, generate: async () => { generation++; persistence++ } })
  assert.deepEqual(result, []); assert.equal(generation, 0); assert.equal(persistence, 0)
})
test('only eligible article reaches generation even when more slots are requested', async () => {
  const generated = []
  const filter = (items, topN) => filterTopArticles(items, topN, { request: async () => response([row(0, { kind: 'procedural_notice' }), row(1)]) })
  await analyzeEligibleArticles(articles, { filter, topN: 3, generate: async a => generated.push(a.id) })
  assert.deepEqual(generated, ['change'])
})
test('high total cannot compensate for a weak axis or insufficient evidence', () => {
  for (const overrides of [{ novelty: 1, magnitude: 3, reach: 3, evidence: 3 }, { input_status: 'insufficient' }, { evidence_quotes: [] }]) {
    assert.equal(applyImpactGate([articles[0]], response([row(0, overrides)])).selected.length, 0)
  }
})
test('keyword 開催 does not automatically reject a substantive change', () => {
  assert.equal(applyImpactGate([articles[0]], response([row(0)])).selected.length, 1)
})
test('equal scores are valid and selection remains deterministic', () => {
  assert.deepEqual(applyImpactGate(articles, response([row(0), row(1)]), 2).selected.map(a => a.id), ['notice', 'change'])
})
test('missing, duplicate, unknown IDs, scores and invented quotations fail closed', () => {
  const bad = [[], [row(0), row(0)], [row(0), row(1, { id: 'alien' })], [row(0), row(1, { magnitude: 99 })], [row(0), row(1, { evidence_quotes: ['存在しない引用'] })]]
  for (const rows of bad) assert.throws(() => applyImpactGate(articles, response(rows)))
})
test('semantic duplicate group selects strongest eligible member; no omitted fallback', () => {
  assert.deepEqual(applyImpactGate(articles, response([row(0), row(1, { duplicate_of: 'a0', evidence: 3 })])).selected.map(a => a.id), ['change'])
  assert.throws(() => applyImpactGate(articles, response([row(0, { duplicate_of: 'a1' }), row(1, { duplicate_of: 'a0' })])), /Cyclic/)
})
test('exact duplicate and empty batches incur no unnecessary request', async () => {
  let calls = 0
  const request = async () => { calls++; return response([row(0)]) }
  await assessArticleImpact([], { request }); await assessArticleImpact(articles, { topN: 0, request })
  assert.equal(calls, 0)
  const result = await assessArticleImpact([articles[0], articles[0]], { request })
  assert.equal(calls, 1); assert.equal(result.selected.length, 1); assert.equal(result.assessments[1].decision, 'duplicate')
})
test('API/parse failure never falls back to generation', async () => {
  let generated = 0
  await assert.rejects(analyzeEligibleArticles(articles, { filter: () => filterTopArticles(articles, 1, { request: async () => { throw Error('failed') } }), generate: () => generated++ }))
  assert.equal(generated, 0)
  assert.throws(() => parseResponseJSON({ status: 'incomplete', output_text: '{"results":[]}' }))
})
test('input truncation is disclosed and does not reduce input to 200 characters', () => {
  const input = impactInputs([{ title: 'title', body: 'あ'.repeat(9000) }])[0]
  assert.equal(input.body.length, 8000); assert.equal(input.body_truncated, true)
})
