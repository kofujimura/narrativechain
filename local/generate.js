import { normalizeInputs } from './input.js'
import { assessArticleImpact } from '../agents/importanceFilter.js'
import { sampleInstructions, sampleSchema } from './narrative-prompts.js'
import { paidJSON, modelSettings } from './api-client.js'
import { join } from 'node:path'
import { saveJSON } from './budget.js'

export async function generateStories({ root, dir, id, inputs, combine, log, signal }) {
  const models = await modelSettings(root)
  log('入力をテキスト化しています。埋め込みスクリプトは実行しません。')
  const articles = await normalizeInputs(inputs, { signal })
  await saveJSON(join(dir, 'articles.json'), articles)
  const gate = await assessArticleImpact(articles, { topN: 6, model: models.filter,
    request: request => paidJSON(root, dir, `${id}/filter`, request, { signal, log }) })
  await saveJSON(join(dir, 'impact.json'), gate)
  log(`インパクト選別: ${gate.selected.length}/${articles.length}件が通過`)
  const groups = combine && gate.selected.length ? [gate.selected] : gate.selected.map(a => [a])
  const stories = []
  for (const group of groups) {
    if (signal?.aborted) throw Error('中止しました')
    const facts = group.map((a, i) => ({ id: `F${i + 1}`, title: a.title, text: a.body, url: a.url, source: a.source, retrieved_at: a.retrieved_at }))
    log(`物語 ${stories.length + 1}/${groups.length}: ${group.map(a => a.title).join(' / ')}`)
    const story = await paidJSON(root, dir, `${id}/story-${stories.length}`, { model: models.generation,
      instructions: `${sampleInstructions}\n入力factsのidを根拠番号に使う。複数のニュースでも根拠のない関連付けはしない。関連が弱ければ共通の連鎖を作らず見送る。`,
      input: JSON.stringify({ facts }), store: false, service_tier: 'default', reasoning: { effort: 'low' }, max_output_tokens: 5000,
      text: { format: { type: 'json_schema', name: 'narrative', strict: true, schema: sampleSchema } },
    }, { log, signal })
    if (!['story', 'abstain'].includes(story.decision) || !Array.isArray(story.chain) || story.chain.length > 3 || !Array.isArray(story.confirmed_facts)) throw Error('物語の出力検証に失敗')
    const ids = new Set(facts.map(f => f.id))
    for (const item of [...story.chain, ...story.confirmed_facts]) if (!Array.isArray(item.fact_ids) || !item.fact_ids.length || item.fact_ids.some(f => !ids.has(f))) throw Error('不明または空の根拠番号を検出')
    if ((story.decision === 'abstain') !== (story.chain.length === 0)) throw Error('見送りと連鎖が不整合')
    stories.push({ id: `story-${stories.length + 1}`, title: group.map(a => a.title).join(' / '), facts, ...story, review: '未検証の仮説。調査前に受注・収益を確定しないでください。' })
  }
  return { articles, assessments: gate.assessments, stories, note: groups.length ? '物語は調査仮説であり投資判断ではありません。' : '該当なし。物語生成は行っていません。' }
}
