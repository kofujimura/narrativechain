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
      content: `あなたは日本企業・産業の専門家です。各ニュースが日本企業に与えるビジネスインパクトを0〜10で個別に評価してください。

評価基準（厳密に適用すること）:
10: 日本の主要産業・大手企業に直接的かつ甚大な影響（例：主要取引国との関係断絶・基幹部品の供給停止）
8〜9: 日本企業の収益・競争力・サプライチェーンに大きな影響（例：重要な規制変更・為替の急激な変動・主要原材料の価格高騰）
6〜7: 特定業種の日本企業に影響（例：半導体・自動車・エネルギー・金融分野の政策・市場変化）
4〜5: 間接的に日本企業へ波及しうる海外の政治・経済動向
2〜3: 日本企業への影響が限定的・一部業種のみ・長期的にのみ関係しうる話題
0〜1: 日本企業とほぼ無関係・スポーツ・芸能・純粋なローカルニュース

重要: 記事ごとに必ず異なるスコアと個別の理由を付けること。全記事に同じスコアを付けてはいけない。

JSONで返してください: {"results": [{"id": "...", "score": 8, "reason": "日本企業への具体的な影響を1文で"}]}`
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
