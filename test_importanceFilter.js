import 'dotenv/config'
import { getUnprocessedArticles } from './db/supabaseClient.js'
import { filterTopArticles } from './agents/importanceFilter.js'

const HOURS = parseInt(process.argv[2] || '4')
const TOP_N = parseInt(process.argv[3] || '3')

const since = new Date(Date.now() - HOURS * 60 * 60 * 1000)
console.log(`直近${HOURS}時間の記事を取得中... (since: ${since.toISOString()})`)

const articles = await getUnprocessedArticles(since)
console.log(`取得件数: ${articles.length}件\n`)

if (articles.length === 0) {
  console.log('記事がありません。時間範囲を広げてください: node test_importanceFilter.js <時間数>')
  process.exit(0)
}

console.log(`上位${TOP_N}件を選別中...`)
const result = await filterTopArticles(articles, TOP_N)

console.log('\n=== 結果 ===')
result.forEach((a, i) => {
  console.log(`${i + 1}. [スコア: ${a.importanceScore}] ${a.title}`)
  console.log(`   理由: ${a.importanceReason}`)
  console.log(`   ソース: ${a.source} | ${a.fetched_at}`)
})
