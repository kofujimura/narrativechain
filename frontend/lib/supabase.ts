export type CausalChain = {
  id: string
  trigger_event_id: string
  depth: number
  score: number
  created_at: string
  trigger_events: {
    id: string
    summary: string
    category: string
    news_articles: {
      title: string
      source: string
      url: string
    }
  }
}

export type ChainWithNodes = CausalChain & {
  chain_nodes: ChainNode[]
}

export type ChainNode = {
  id: string
  chain_id: string
  step_number: number
  event_text: string
  reasoning: string
  confidence_score: number
  sources: string[]
}
