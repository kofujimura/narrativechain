import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function saveArticles(articles) {
  const { error } = await supabase
    .from('news_articles')
    .upsert(articles, { onConflict: 'url', ignoreDuplicates: true })
  if (error) throw error
}

export async function getUnprocessedArticles(since) {
  const { data, error } = await supabase
    .from('news_articles')
    .select('*')
    .gte('fetched_at', since.toISOString())
    .order('fetched_at', { ascending: false })
  if (error) throw error
  return data
}

export async function saveTriggerEvent(articleId, summary, category) {
  const { data, error } = await supabase
    .from('trigger_events')
    .insert({ article_id: articleId, summary, category })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function saveCausalChain(triggerEventId, depth, score, nodes) {
  const { data: chain, error: chainError } = await supabase
    .from('causal_chains')
    .insert({ trigger_event_id: triggerEventId, depth, score })
    .select()
    .single()
  if (chainError) throw chainError

  const nodeRows = nodes.map((n, i) => ({
    chain_id: chain.id,
    step_number: i + 1,
    event_text: n.event,
    reasoning: n.reasoning,
    confidence_score: n.confidence,
    sources: n.sources || [],
  }))

  const { error: nodesError } = await supabase
    .from('chain_nodes')
    .insert(nodeRows)
  if (nodesError) throw nodesError

  return chain
}

export default supabase
