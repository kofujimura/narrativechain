import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireResearchOwner } from '../../../lib/research-auth'
import { renderArtifactHTML, validDocumentId } from '../../../lib/artifact-format.mjs'

export const dynamic = 'force-dynamic'

export default async function ResearchDocument({ params }: { params: Promise<{ id: string }> }) {
  const client = await requireResearchOwner()
  const { id } = await params
  if (!validDocumentId(id)) notFound()
  const { data, error } = await client.from('research_documents').select('id,kind,title,packet,parent_id').eq('id', id).maybeSingle()
  if (error) return <main className="p-8">保存結果を読み込めません。DBの設定を確認してください。</main>
  if (!data) notFound()
  let html
  try { html = renderArtifactHTML(data.packet) } catch { return <main className="p-8">登録JSONの検証に失敗しました。表示を停止しています。</main> }
  const { data: reports } = await client.from('research_documents').select('id,title').eq('parent_id', id).order('created_at', { ascending: false }).limit(20)
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <Link href="/research" className="text-sm underline">← 保存結果</Link>
    <h1 className="mt-4 text-xl font-bold">{data.title}</h1>
    <nav className="my-5 flex flex-wrap gap-4 text-sm">
      <a href={`/api/research/documents/${id}`} className="underline">{data.kind === 'story' ? '調査用JSONを保存' : '調査JSONを保存'}</a>
      {data.kind === 'story' && <Link href={`/research/import?parent=${id}`} className="underline">この物語の調査結果を登録</Link>}
      {data.parent_id && <Link href={`/research/${data.parent_id}`} className="underline">元の物語</Link>}
    </nav>
    {data.kind === 'story' && <p className="mb-5 text-sm text-zinc-500">調査用JSONを保存し、Terminal / Hermesで $narrative-investigation に渡してください。Vercel内では調査エージェントを起動しません。</p>}
    <iframe title="保存された研究結果" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="h-[80vh] w-full rounded-xl border border-zinc-300 bg-white" />
    {reports?.length ? <section className="mt-6"><h2 className="font-bold">関連する調査結果</h2>{reports.map(report => <p key={report.id} className="mt-2"><Link className="underline" href={`/research/${report.id}`}>{report.title}</Link></p>)}</section> : null}
  </main>
}
