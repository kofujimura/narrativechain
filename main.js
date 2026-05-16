import 'dotenv/config'
import { fetchAllNews } from './ingestor/fetchNews.js'
import { filterTopArticles } from './agents/importanceFilter.js'
import { generateCausalChain } from './agents/causalChain.js'
import { saveArticles, getUnprocessedArticles, saveTriggerEvent, saveCausalChain } from './db/supabaseClient.js'

const NEWS_INTERVAL_MS     = 30 * 60 * 1000  // 30分
const ANALYSIS_INTERVAL_MS =  1 * 60 * 60 * 1000  // 1時間
const WINDOW_MS            =  4 * 60 * 60 * 1000  // スライディングウィンドウ幅

// 選出済み記事ID → 選出日時
const selectedArticles = new Map()

function purgeOldSelections() {
  const cutoff = Date.now() - WINDOW_MS
  for (const [id, time] of selectedArticles) {
    if (time < cutoff) selectedArticles.delete(id)
  }
}

async function ingestNews() {
  console.log(`[${new Date().toISOString()}] ニュース取得開始`)
  const articles = await fetchAllNews()
  await saveArticles(articles)
  console.log(`[${new Date().toISOString()}] ${articles.length}件保存完了`)
}

async function runAnalysis() {
  console.log(`[${new Date().toISOString()}] 分析パイプライン開始`)

  purgeOldSelections()

  // 直近4時間のニュースを取得し、選出済みを除外
  const since = new Date(Date.now() - WINDOW_MS)
  const articles = (await getUnprocessedArticles(since))
    .filter(a => !selectedArticles.has(a.id))

  if (articles.length === 0) {
    console.log('分析対象のニュースがありません（選出済み除外後）')
    return
  }

  console.log(`候補: ${articles.length}件（選出済み除外済み）`)

  // 重要度上位1件を選出
  const [article] = await filterTopArticles(articles, 1)
  console.log(`選出: [${article.importanceScore}] ${article.title}`)

  selectedArticles.set(article.id, Date.now())

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
