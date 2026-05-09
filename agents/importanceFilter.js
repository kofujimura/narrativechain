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
      content: `あなたは世界経済の専門家です。各ニュースが世界経済に与える影響度を0〜10で個別に評価してください。

評価基準（厳密に適用すること）:
10: 世界規模の金融危機・大国間の戦争勃発・主要国の政権崩壊
8〜9: 主要国の重大な政策転換・大規模な資源供給障害・グローバルな金融市場への大きな衝撃
6〜7: 複数国に影響する政治・経済イベント・重要な貿易・エネルギー問題
4〜5: 単一国内の政策変更・地域経済への影響・業界レベルの供給問題
2〜3: 限定的・局所的な影響・1企業や1地域のみの話題
0〜1: 世界経済と無関係・スポーツ・芸能・ローカルニュース

重要: 記事ごとに必ず異なるスコアと個別の理由を付けること。全記事に同じスコアを付けてはいけない。

JSONで返してください: {"results": [{"id": "...", "score": 8, "reason": "このニュース固有の影響を1文で"}]}`
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
