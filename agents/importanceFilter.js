import { IMPACT_MODEL, buildImpactRequest, applyImpactGate, parseResponseJSON } from './impactPolicy.js'
export { IMPACT_MODEL, buildImpactRequest, impactInputs, applyImpactGate, parseResponseJSON } from './impactPolicy.js'

async function requestImpact(request) {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 120000 })
  return parseResponseJSON(await client.responses.create(request))
}
export async function assessArticleImpact(articles, { topN = 3, request = requestImpact,
  model = process.env.OPENAI_FILTER_MODEL || IMPACT_MODEL } = {}) {
  if (!Array.isArray(articles) || !Number.isInteger(topN) || topN < 0) throw new Error('Invalid filter arguments')
  if (!articles.length || topN === 0) return { assessments: [], selected: [] }
  // Bound each request. Only exact duplicates are removed across different batches.
  const unique = [], duplicates = [], seen = new Map()
  for (const a of articles) {
    const key = a.url || (a.title ? `${a.source ?? ''}/${a.title}` : null)
    if (key && seen.has(key)) { duplicates.push({ article: a, decision: 'duplicate', reason: '同一URLまたは同一ソース・見出し', duplicate_of_article: seen.get(key) }); continue }
    if (key) seen.set(key, a.id ?? a.url ?? a.title)
    unique.push(a)
  }
  const assessments = [], selected = []
  for (let start = 0; start < unique.length; start += 8) {
    const batch = unique.slice(start, start + 8)
    const result = applyImpactGate(batch, await request(buildImpactRequest(batch, model)), batch.length)
    assessments.push(...result.assessments.map(r => ({ ...r, batch: start / 8, article: batch[r.index] })))
    selected.push(...result.selected)
  }
  return { assessments: [...assessments, ...duplicates], selected: selected.sort((a, b) => b.importanceScore - a.importanceScore).slice(0, topN) }
}
export async function filterTopArticles(articles, topN = 3, options = {}) {
  return (await assessArticleImpact(articles, { ...options, topN })).selected
}
