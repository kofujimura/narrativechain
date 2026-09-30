import { normalizeInputs } from './input.js'
import { deduplicateImpactArticles } from '../agents/importanceFilter.js'
import { buildImpactRequest, applyImpactGate } from '../agents/impactPolicy.js'
import { sampleInstructions, sampleSchema } from './narrative-prompts.js'
import { paidJSON, modelSettings, codexModelSettings, generationBackend } from './api-client.js'
import { codexJSON } from './codex-client.js'
import { renderStoriesHTML } from './story-html.js'
import { join } from 'node:path'
import { saveJSON, readJSON } from './budget.js'
import { writeFile } from 'node:fs/promises'

export async function prepareGeneration({ root, dir, inputs, combine = false, backend = 'codex', signal, log = () => {} }) {
  const models = backend === 'api' ? await modelSettings(root) : await codexModelSettings(root)
  log('入力をテキスト化しています。埋め込みスクリプトは実行しません。')
  const articles = await normalizeInputs(inputs, { signal })
  await saveJSON(join(dir, 'articles.json'), articles)
  await saveJSON(join(dir, 'generation.json'), { backend, models, combine })
  const { unique } = deduplicateImpactArticles(articles)
  const request = buildImpactRequest(unique, models.filter)
  await saveJSON(join(dir, 'filter-request.json'), request)
  return request
}
export async function planGeneration({ dir, raw, log = () => {} }) {
  const articles = await readJSON(join(dir, 'articles.json'))
  const { models, combine } = await readJSON(join(dir, 'generation.json'))
  const { unique, duplicates } = deduplicateImpactArticles(articles)
  const gate = applyImpactGate(unique, raw, 6)
  gate.assessments = [...gate.assessments.map(r => ({ ...r, article: unique[r.index] })), ...duplicates]
  await saveJSON(join(dir, 'impact.json'), gate)
  log(`インパクト選別: ${gate.selected.length}/${articles.length}件が通過`)
  const groups = combine && gate.selected.length ? [gate.selected] : gate.selected.map(a => [a])
  const plan = groups.map((group, i) => {
    const facts = group.map((a, j) => ({ id: `F${j + 1}`, title: a.title, text: a.body, url: a.url, source: a.source, retrieved_at: a.retrieved_at }))
    return { id: `story-${i + 1}`, title: group.map(a => a.title).join(' / '), facts,
      request: { model: models.generation, instructions: `${sampleInstructions}\n入力factsのidを根拠番号に使う。複数のニュースでも根拠のない関連付けはしない。関連が弱ければ共通の連鎖を作らず見送る。`,
        input: JSON.stringify({ facts }), store: false, service_tier: 'default', reasoning: { effort: 'low' }, max_output_tokens: 5000,
        text: { format: { type: 'json_schema', name: 'narrative', strict: true, schema: sampleSchema } } } }
  })
  await saveJSON(join(dir, 'plan.json'), plan)
  for (const item of plan) await saveJSON(join(dir, `${item.id}-request.json`), item.request)
  return plan
}
export function validateStory(story, facts) {
  if (!story || !['story', 'abstain'].includes(story.decision) || typeof story.narrative !== 'string' || !story.narrative.trim() ||
    !Array.isArray(story.chain) || story.chain.length > 3 || !Array.isArray(story.confirmed_facts) ||
    !Array.isArray(story.questions) || story.questions.length > 2 || story.questions.some(q => typeof q !== 'string')) throw Error('物語の出力検証に失敗')
  const ids = new Set(facts.map(f => f.id))
  for (const item of [...story.chain, ...story.confirmed_facts]) if (!Array.isArray(item.fact_ids) || !item.fact_ids.length || item.fact_ids.some(f => !ids.has(f))) throw Error('不明または空の根拠番号を検出')
  for (const c of story.chain) for (const k of ['event', 'mechanism', 'condition', 'refutation']) if (typeof c[k] !== 'string' || !c[k].trim()) throw Error('波及仮説の説明が不正')
  for (const f of story.confirmed_facts) if (typeof f.fact !== 'string' || !f.fact.trim()) throw Error('確認事実の説明が不正')
  if ((story.decision === 'abstain') !== (story.chain.length === 0)) throw Error('見送りと連鎖が不整合')
  if (story.decision === 'story' && !story.confirmed_facts.length) throw Error('物語の起点となる確認事実がありません。')
  return { decision: story.decision, confirmed_facts: story.confirmed_facts, chain: story.chain, narrative: story.narrative, questions: story.questions }
}
export async function finishGeneration({ dir }) {
  const articles = await readJSON(join(dir, 'articles.json')), gate = await readJSON(join(dir, 'impact.json'))
  const plan = await readJSON(join(dir, 'plan.json')), settings = await readJSON(join(dir, 'generation.json'))
  const stories = []
  for (const item of plan) {
    const story = validateStory(await readJSON(join(dir, `${item.id}-result.json`)), item.facts)
    stories.push({ id: item.id, title: item.title, facts: item.facts, ...story, review: '未検証の仮説。調査前に受注・収益を確定しないでください。' })
  }
  const result = { articles, assessments: gate.assessments, stories, backend: settings.backend,
    note: plan.length ? '物語は調査仮説であり投資判断ではありません。' : '該当なし。物語生成は行っていません。' }
  // Validate all stories before publishing any packet or HTML.
  for (const story of stories) await saveJSON(join(dir, `${story.id}.json`), { schema_version: 'narrative-investigation/v1', exported_at: new Date().toISOString(), story })
  await saveJSON(join(dir, 'result.json'), result)
  await writeFile(join(dir, 'stories.html'), renderStoriesHTML(result), { mode: 0o600 })
  return result
}
export async function generateStories({ root, dir, id, inputs, combine, backend, log = () => {}, signal, requestJSON }) {
  backend = await generationBackend(root, backend)
  const request = requestJSON ?? (backend === 'api' ? paidJSON : codexJSON)
  const filterRequest = await prepareGeneration({ root, dir, inputs, combine, backend, log, signal })
  const raw = await request(root, dir, `${id}/filter`, filterRequest, { signal, log })
  await saveJSON(join(dir, 'filter-result.json'), raw)
  const plan = await planGeneration({ dir, raw, log })
  for (const [i, item] of plan.entries()) {
    if (signal?.aborted) throw Error('中止しました')
    log(`物語 ${i + 1}/${plan.length}: ${item.title}`)
    const story = await request(root, dir, `${id}/${item.id}`, item.request, { signal, log })
    validateStory(story, item.facts)
    await saveJSON(join(dir, `${item.id}-result.json`), story)
  }
  return finishGeneration({ dir })
}
