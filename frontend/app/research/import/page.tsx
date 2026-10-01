import Link from 'next/link'
import { requireResearchOwner } from '../../../lib/research-auth'
import { validDocumentId } from '../../../lib/artifact-format.mjs'
import { importArtifact } from './actions'

export const dynamic = 'force-dynamic'
const errors: Record<string, string> = {
  invalid_packet: 'JSONの形式またはサイズが不正です。スキルが出力したJSON（240KB以内）を選んでください。HTMLは取り込めません。',
  invalid_parent: '関連付ける物語が見つからないか、物語以外のJSONです。',
  database_unavailable: 'DBに保存できません。追加SQLと本人の許可設定を確認してください。',
}
export default async function Import({ searchParams }: { searchParams: Promise<{ error?: string; parent?: string }> }) {
  await requireResearchOwner()
  const { error, parent } = await searchParams
  return <main className="mx-auto max-w-xl px-6 py-12">
    <Link href="/research" className="text-sm underline">← 保存結果</Link>
    <h1 className="mt-6 text-2xl font-bold">スキルのJSONを取り込む</h1>
    <p className="mt-4 text-sm">$narrative-story の story-N.json、または $narrative-investigation の report.json を選択します。本人専用DBに保存し、HTMLを安全に再生成して表示します。生成AIのAPIは呼びません。</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{Object.hasOwn(errors, error) ? errors[error] : errors.invalid_packet}</p>}
    <form action={importArtifact} className="mt-8 space-y-5">
      <label className="block">生成されたJSON<input name="packet" type="file" accept=".json,application/json" required className="mt-2 block w-full rounded border p-3" /></label>
      {validDocumentId(parent) && <><input type="hidden" name="parent" value={parent} /><p className="text-sm">選んだ物語に調査結果を関連付けます。</p></>}
      <button className="rounded-lg bg-zinc-800 px-5 py-3 text-white">本人専用サイトに登録</button>
    </form>
  </main>
}
