import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function filterTopArticles(articles, topN = 3) {
  const articleList = articles.map((a, i) =>
    `ID: ${a.source}-${i}\nタイトル: ${a.title}\n概要: ${a.body?.slice(0, 200)}`
  ).join('\n\n---\n\n')

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'system',
      content: `各ニュースが日本企業に与えるビジネスインパクトを0〜99で個別に評価してください。

評価基準（厳密に適用すること）:
80〜99: 特定業種の日本企業に影響（例：半導体・エネルギー・金融・情報・医療分野の企業提携や新技術や規制変更など）
60〜79: 日本企業全体の収益・競争力・サプライチェーンに影響（例：為替の急激な変動・主要原材料の価格高騰）
40〜59: 間接的に日本企業へ波及しうる海外の政治・経済動向
20〜39: 日本企業への影響が限定的・短期的にのみ関係しうる話題
 0〜19: 日本企業とほぼ無関係・事件・スポーツ・芸能・純粋なローカルニュース

重要:
- 同じ出来事を扱う記事が複数ある場合は、最もスコアが高い1件のみ結果に含め、他は除外すること。
- 記事ごとに必ず異なるスコアと個別の理由を付けること。全記事に同じスコアを付けてはいけない。

JSONで返してください: {"results": [{"id": "...", "score": 85, "reason": "日本企業への具体的な影響を1文で"}]}`
    }, {
      role: 'user',
      content: articleList,
    }],
  })

  const { results } = JSON.parse(response.choices[0].message.content)

  const scored = articles.map((a, i) => {
    const r = results.find(r => r.id === `${a.source}-${i}`)
    return { ...a, importanceScore: r?.score ?? 0, importanceReason: r?.reason ?? '' }
  }).sort((a, b) => b.importanceScore - a.importanceScore)

  return scored.slice(0, topN)
}
