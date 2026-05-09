import 'dotenv/config'
import { fetchAllNews } from './ingestor/fetchNews.js'
import { filterTopArticles } from './agents/importanceFilter.js'
import { generateCausalChain } from './agents/causalChain.js'
import { saveArticles, getUnprocessedArticles, saveTriggerEvent, saveCausalChain } from './db/supabaseClient.js'

const NEWS_INTERVAL_MS  = 30 * 60 * 1000   // 30分
const ANALYSIS_INTERVAL_MS = 4 * 60 * 60 * 1000  // 4時間

async function ingestNews() {
  console.log(`[${new Date().toISOString()}] ニュース取得開始`)
  const articles = await fetchAllNews()
  await saveArticles(articles)
  console.log(`[${new Date().toISOString()}] ${articles.length}件保存完了`)
}

async function runAnalysis() {
  console.log(`[${new Date().toISOString()}] 分析パイプライン開始`)

  // 直近4時間のニュースを取得
  const since = new Date(Date.now() - ANALYSIS_INTERVAL_MS)
  const articles = await getUnprocessedArticles(since)

  if (articles.length === 0) {
    console.log('分析対象のニュースがありません')
    return
  }

  // 重要度上位3件を選出
  const top3 = await filterTopArticles(articles, 3)
  console.log(`上位3件を選出: ${top3.map(a => `[${a.importanceScore}] ${a.title}`).join(', ')}`)

  // 各記事について因果チェーン生成
  for (const article of top3) {
    try {
      console.log(`因果チェーン生成中: ${article.title}`)
      const result = await generateCausalChain(article)

      const triggerEvent = await saveTriggerEvent(
        article.id,
        result.trigger,
        article.category
      )

      await saveCausalChain(
        triggerEvent.id,
        result.chain.length,
        article.importanceScore,
        result.chain
      )

      console.log(`保存完了: ${result.trigger}`)
    } catch (e) {
      console.error(`エラー (${article.title}):`, e.message)
    }
  }

  console.log(`[${new Date().toISOString()}] 分析パイプライン完了`)
}

async function main() {
  console.log('NarrativeChain 起動')

  // 起動直後に両方実行
  await ingestNews()
  await runAnalysis()

  // 以降は定期実行
  setInterval(ingestNews, NEWS_INTERVAL_MS)
  setInterval(runAnalysis, ANALYSIS_INTERVAL_MS)
}

main().catch(console.error)
