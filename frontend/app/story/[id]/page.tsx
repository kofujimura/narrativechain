import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabase, type ChainWithNodes } from '../../../lib/supabase'

async function fetchChain(id: string): Promise<ChainWithNodes | null> {
  const { data, error } = await supabase
    .from('causal_chains')
    .select(`
      *,
      trigger_events(id, summary, category, news_articles(title, source, url, published_at)),
      chain_nodes(*)
    `)
    .eq('id', id)
    .single()

  if (error || !data) return null
  const chain = data as ChainWithNodes
  chain.chain_nodes = chain.chain_nodes.sort((a, b) => a.step_number - b.step_number)
  return chain
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    score >= 0.7 ? 'bg-emerald-500' :
    score >= 0.4 ? 'bg-yellow-400' :
    'bg-zinc-300'
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <div className="h-1.5 w-24 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span>確信度 {pct}%</span>
    </div>
  )
}

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const chain = await fetchChain(id)
  if (!chain) notFound()

  const article = chain.trigger_events?.news_articles
  const trigger = chain.trigger_events

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
      >
        ← 一覧に戻る
      </Link>

      <section className="mb-10">
        {trigger?.category && (
          <span className="text-xs font-medium rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800 dark:text-zinc-300">
            {trigger.category}
          </span>
        )}
        <h1 className="mt-3 text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
          {trigger?.summary}
        </h1>
        {article && (
          <p className="mt-2 text-sm text-zinc-500">
            ソース:{' '}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {article.title}
            </a>{' '}
            — {article.source}
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-400">
          スコア {Math.round(chain.score)} &nbsp;·&nbsp; 深さ {chain.depth}
        </p>
      </section>

      <ol className="relative border-l border-zinc-200 dark:border-zinc-700 flex flex-col gap-0">
        {chain.chain_nodes.map((node, i) => (
          <li key={node.id} className="ml-6 pb-10 last:pb-0">
            <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold ring-4 ring-white dark:ring-zinc-950">
              {i + 1}
            </span>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
              {node.event_text}
            </p>
            <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {node.reasoning}
            </p>
            <div className="mt-2">
              <ConfidenceBar score={node.confidence_score} />
            </div>
            {node.sources && node.sources.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {node.sources.map((src, j) => (
                  <li key={j}>
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 underline break-all"
                    >
                      [{j + 1}] {src}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </main>
  )
}
