const str = { type: 'string' }, number = { type: ['number', 'null'] }
const array = items => ({ type: 'array', items })
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const metric = object({ numerator: number, denominator: number, numerator_period: str, denominator_period: str,
  numerator_scope: str, denominator_scope: str, unit: str, theme_match: { type: 'boolean' }, evidence_urls: array(str), note: str })
export const reportSchema = object({ summary: str, as_of: str, candidates: array(object({ company: str, listed_entity: str, ticker: str,
  role: str, relationship_status: { type: 'string', enum: ['confirmed_order', 'historical_relationship', 'capability_only', 'unknown'] },
  evidence: array(object({ url: str, title: str, claim: str, published_at: str })), theme_purity: metric, annual_materiality: metric,
  risks: array(str), next_questions: array(str) })), limitations: array(str), next_questions: array(str) })
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]))
export function safeLink(url) { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '' } catch { return '' } }
export function ratio(m) {
  if (!m || !Number.isFinite(m.numerator) || !Number.isFinite(m.denominator) || m.numerator < 0 || m.denominator <= 0 || m.numerator > m.denominator ||
    !m.theme_match || !m.numerator_period || m.numerator_period !== m.denominator_period || !m.numerator_scope || m.numerator_scope !== m.denominator_scope ||
    !m.unit || !Array.isArray(m.evidence_urls) || !m.evidence_urls.length || m.evidence_urls.some(u => !safeLink(u))) return null
  return m.numerator / m.denominator * 100
}
export function validateReport(report) {
  if (!report || typeof report.summary !== 'string' || typeof report.as_of !== 'string' || !Array.isArray(report.candidates) || report.candidates.length > 2 ||
    !Array.isArray(report.limitations) || !Array.isArray(report.next_questions)) throw Error('調査JSONの形式が不正です。')
  for (const c of report.candidates) {
    for (const k of ['company', 'listed_entity', 'ticker', 'role']) if (typeof c[k] !== 'string') throw Error('企業情報が不正です。')
    if (!['confirmed_order', 'historical_relationship', 'capability_only', 'unknown'].includes(c.relationship_status) || !Array.isArray(c.evidence) || !Array.isArray(c.risks) || !Array.isArray(c.next_questions)) throw Error('調査根拠が不正です。')
    if (c.relationship_status === 'confirmed_order' && !c.evidence.some(e => safeLink(e.url))) throw Error('受注確定に根拠URLがありません。')
    for (const key of ['theme_purity', 'annual_materiality']) if (!c[key] || !Array.isArray(c[key].evidence_urls)) throw Error('指標の構造が不正です。')
  }
  return report
}
export function renderReport(report, { demo = false } = {}) {
  validateReport(report)
  const e = escapeHTML, list = items => `<ul>${items.map(x => `<li>${e(x)}</li>`).join('')}</ul>`
  const labels = { confirmed_order: '今回案件の受注を示す資料あり（要原文確認）', historical_relationship: '過去の取引関係のみ', capability_only: '能力・製品の適合のみ', unknown: '関係未確認' }
  const metricHTML = (name, m) => `<section><h3>${name}</h3><strong>${ratio(m) === null ? '算定不可・未確認' : `${ratio(m).toFixed(3)}%（同期間・同範囲の資料値から計算）`}</strong><p>${e(m.note)}</p><small>${e(m.numerator_period)} / ${e(m.numerator_scope)} / ${e(m.unit)}</small></section>`
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>調査レポート</title><style>body{font:15px/1.8 system-ui,sans-serif;color:#263b36;background:#fcfcf8;max-width:900px;margin:0 auto;padding:28px}article{border:1px solid #d5dfd4;border-radius:12px;padding:24px;margin:20px 0}h1{font-size:25px}h2{font-size:21px}h3{font-size:16px}small{color:#60736b}a{color:#1b6753;word-break:break-all}.notice{padding:14px;background:#f8edcc;border-radius:8px}section{background:#eef3ed;padding:14px;margin:12px 0}</style><h1>${demo ? 'デモ調査（架空データ）' : '物語の検証レポート'}</h1><p class="notice">${demo ? '動作確認用。実企業の調査・外部検索は行っていません。' : 'AIによる調査結果です。投資判断・売買推奨ではありません。引用先と資料の日付を確認してください。'}</p><small>調査基準日 ${e(report.as_of)}</small><p>${e(report.summary)}</p>${report.candidates.map(c => `<article><h2>${e(c.company)}</h2><p>${e(c.listed_entity)} ${e(c.ticker)}</p><strong>${labels[c.relationship_status]}</strong><p>${e(c.role)}</p>${metricHTML('テーマ純度', c.theme_purity)}${metricHTML('年間案件寄与 / 連結売上', c.annual_materiality)}<h3>根拠資料</h3><ul>${c.evidence.map(s => `<li>${safeLink(s.url) ? `<a href="${e(safeLink(s.url))}" target="_blank" rel="noopener noreferrer">${e(s.title)}</a>` : e(s.title)} ${e(s.published_at)}<p>${e(s.claim)}</p></li>`).join('')}</ul><h3>リスク・不確実性</h3>${list(c.risks)}<h3>次に確認すること</h3>${list(c.next_questions)}</article>`).join('')}<h2>今回の限界</h2>${list(report.limitations)}<h2>追加調査</h2>${list(report.next_questions)}</html>`
}
