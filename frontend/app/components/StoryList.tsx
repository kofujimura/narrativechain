'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type CausalChain } from '../../lib/supabase'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score)
  const color =
    score >= 70 ? 'bg-red-100 text-red-700' :
    score >= 40 ? 'bg-yellow-100 text-yellow-700' :
    'bg-zinc-100 text-zinc-500'
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
      スコア {pct}
    </span>
  )
}

export default function StoryList({ initial }: { initial: CausalChain[] }) {
  const [chains, setChains] = useState<CausalChain[]>(initial)

  useEffect(() => {
    const channel = supabase
      .channel('causal_chains_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'causal_chains' },
        async (payload) => {
          const { data } = await supabase
            .from('causal_chains')
            .select('*, trigger_events(id, summary, category, news_articles(title, source, url))')
            .eq('id', payload.new.id)
            .single()
          if (data) setChains((prev) => [data as CausalChain, ...prev])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  if (chains.length === 0) {
    return (
      <p className="text-zinc-400 text-center py-24">
        まだ物語がありません。バックエンドの生成を待っています…
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-4">
      {chains.map((chain) => (
        <li key={chain.id}>
          <Link
            href={`/story/${chain.id}`}
            className="block rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400 transition-colors dark:bg-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            <div className="flex items-start justify-between gap-4">
              <p className="text-base font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
                {chain.trigger_events?.summary ?? '（トリガー不明）'}
              </p>
              <ScoreBadge score={chain.score} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              {chain.trigger_events?.category && (
                <span className="rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                  {chain.trigger_events.category}
                </span>
              )}
              <span>{chain.trigger_events?.news_articles?.source}</span>
              <span suppressHydrationWarning>{formatDate(chain.created_at)}</span>
              <span>深さ {chain.depth}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
