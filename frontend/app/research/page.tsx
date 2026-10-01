import Link from 'next/link'
import { requireResearchOwner } from '../../lib/research-auth'

export const dynamic = 'force-dynamic'

export default async function Research() {
  const client = await requireResearchOwner()
  const { data, error } = await client.from('research_documents').select('id,kind,title,summary,created_at,parent_id').order('created_at', { ascending: false }).limit(50)
  return <main className="mx-auto max-w-3xl px-6 py-12">
    <Link href="/" className="text-sm underline">← ホーム</Link>
    <h1 className="mt-6 text-2xl font-bold">スキルの物語・調査レポート</h1>
    <p className="mt-3 text-sm text-zinc-500">本人専用の保存結果です。登録しても一般公開されません。</p>
    <Link href="/research/import" className="mt-5 inline-block rounded-lg bg-zinc-800 px-4 py-2 text-white">JSONを取り込む</Link>
    {error ? <p role="alert" className="mt-6">保存テーブルを読み込めません。research_documentsの追加SQLを確認してください。</p> :
      data?.length ? data.map(item => <article key={item.id} className="mt-6 rounded-xl border border-zinc-300 p-5">
        <p className="text-xs text-zinc-500">{item.kind === 'story' ? '物語' : '調査'} · {new Date(item.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>
        <h2 className="mt-2 font-semibold"><Link href={`/research/${item.id}`} className="underline">{item.title}</Link></h2>
        <p className="mt-3 text-sm">{item.summary}</p>
      </article>) : <p className="mt-8">まだ登録された生成物はありません。</p>}
  </main>
}
