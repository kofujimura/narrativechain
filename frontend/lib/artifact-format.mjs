import { reportSchema, renderReport, safeLink } from './report-renderer.mjs'
import { renderStoriesHTML } from './story-renderer.mjs'

export const MAX_ARTIFACT_BYTES = 240000
export const validDocumentId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const str = { type: 'string' }
const array = (items, maxItems = 30) => ({ type: 'array', items, maxItems })
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const factReference = object({ fact: str, fact_ids: array(str, 6) })
const chain = object({ event: str, mechanism: str, fact_ids: array(str, 6), condition: str, refutation: str })
const fact = object({ id: str, title: str, text: { type: 'string', maxLength: 60000 }, url: str, source: str, retrieved_at: str })
const storySchema = object({ id: str, title: str, facts: array(fact, 6), decision: { type: 'string', enum: ['story', 'abstain'] }, confirmed_facts: array(factReference, 20), chain: array(chain, 3), narrative: str, questions: array(str, 2), review: str })

function check(value, schema, depth = 0) {
  if (depth > 14) throw Error('JSONが深すぎます。')
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (!(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(type)) throw Error('JSONの型が不正です。')
  if (schema.enum && !schema.enum.includes(value)) throw Error('JSONの区分が不正です。')
  if (type === 'string' && value.includes('\u0000')) throw Error('JSONにNUL文字が含まれています。')
  if (type === 'string' && value.length > (schema.maxLength ?? 15000)) throw Error('JSONの文章が長すぎます。')
  if (type === 'number' && !Number.isFinite(value)) throw Error('JSONの数値が不正です。')
  if (type === 'array') {
    if (value.length > (schema.maxItems ?? 30)) throw Error('JSONの項目が多すぎます。')
    for (const item of value) check(item, schema.items, depth + 1)
  }
  if (type === 'object') {
    if (schema.required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) throw Error('JSONの項目が不正です。')
    for (const [key, child] of Object.entries(value)) check(child, schema.properties[key], depth + 1)
  }
}
const size = value => new TextEncoder().encode(JSON.stringify(value)).length

export function normalizeArtifact(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || size(input) > MAX_ARTIFACT_BYTES) throw Error('対応するJSON形式またはサイズではありません。')
  if (input.schema_version === 'narrative-investigation/v1') {
    if (Object.keys(input).some(key => !['schema_version', 'exported_at', 'story'].includes(key))) throw Error('物語パケットの項目が不正です。')
    check(input.story, storySchema)
    const s = input.story
    if (!s.title.trim() || s.title.length > 500 || !s.narrative.trim() || !s.facts.length || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)) throw Error('物語の起点・タイトルが不正です。')
    const ids = new Set(s.facts.map(f => f.id))
    if (ids.size !== s.facts.length || s.facts.some(f => !/^[a-zA-Z0-9_-]{1,32}$/.test(f.id) || !f.text.trim() || (f.url && !safeLink(f.url)))) throw Error('資料の根拠番号・本文・URLが不正です。')
    if ((s.decision === 'abstain') !== (s.chain.length === 0) || (s.decision === 'story' && !s.confirmed_facts.length)) throw Error('物語の判断と連鎖が不一致です。')
    for (const item of [...s.confirmed_facts, ...s.chain]) {
      if (!item.fact_ids.length || item.fact_ids.some(id => !ids.has(id))) throw Error('不明な根拠番号があります。')
      for (const [key, value] of Object.entries(item)) if (key !== 'fact_ids' && !value.trim()) throw Error('空の物語説明があります。')
    }
    return { kind: 'story', title: s.title, summary: s.narrative, packet: { schema_version: 'narrative-investigation/v1', story: JSON.parse(JSON.stringify(s)) } }
  }
  const report = input.schema_version === 'narrative-report/v1' ? input.report : input
  if (input.schema_version && input.schema_version !== 'narrative-report/v1') throw Error('未対応のJSONスキーマです。')
  if (input.schema_version && Object.keys(input).some(key => !['schema_version', 'report', 'demo'].includes(key))) throw Error('調査パケットの項目が不正です。')
  if (input.schema_version && input.demo !== undefined && typeof input.demo !== 'boolean') throw Error('デモ区分が不正です。')
  check(report, reportSchema)
  if (!report.summary.trim() || report.candidates.length > 2 || !/^\d{4}-\d{2}-\d{2}$/.test(report.as_of)) throw Error('調査結果の概要・日付・候補数が不正です。')
  for (const candidate of report.candidates) {
    if (candidate.evidence.some(e => !safeLink(e.url)) || (candidate.relationship_status === 'confirmed_order' && !candidate.evidence.length)) throw Error('調査根拠URLが不正です。')
    for (const metric of [candidate.theme_purity, candidate.annual_materiality]) if (metric.evidence_urls.some(url => !safeLink(url))) throw Error('指標の根拠URLが不正です。')
  }
  const demo = input.schema_version === 'narrative-report/v1' && input.demo === true
  return { kind: 'investigation', title: `${demo ? 'デモ調査' : '調査レポート'} · ${report.as_of}`, summary: report.summary, packet: { schema_version: 'narrative-report/v1', report: JSON.parse(JSON.stringify(report)), demo } }
}

export function renderArtifactHTML(packet) {
  const normalized = normalizeArtifact(packet)
  if (normalized.kind === 'investigation') return renderReport(normalized.packet.report, { demo: normalized.packet.demo })
  // Download is offered by the authenticated outer page, not inside srcdoc.
  return renderStoriesHTML({ stories: [normalized.packet.story], assessments: [], backend: 'agent skill', note: '登録された研究用の物語です。' }).replace(/<a href="[^"]*\.json" download>調査用JSONを保存<\/a>/g, '')
}
