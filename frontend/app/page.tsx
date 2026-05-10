import { supabase, type CausalChain } from '../lib/supabase'
import StoryList from './components/StoryList'

export const dynamic = 'force-dynamic'

async function fetchChains(): Promise<CausalChain[]> {
  const { data, error } = await supabase
    .from('causal_chains')
    .select('*, trigger_events(id, summary, category, news_articles(title, source, url))')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('fetchChains error:', error)
    return []
  }
  return data as CausalChain[]
}

export default async function Home() {
  const chains = await fetchChains()

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
          NarrativeChain
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          ニュースから生成された未来の因果連鎖
        </p>
      </header>
      <StoryList initial={chains} />
    </main>
  )
}
