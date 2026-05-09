import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function generateCausalChain(article) {
  const prompt = `あなたは地政学・経済・産業の因果関係を分析する専門家です。
以下のニュースから、世界経済に波及する因果連鎖を4〜6ステップで推論してください。
必要に応じてWeb検索で最新情報を確認してください。

タイトル: ${article.title}
概要: ${article.body}
出典: ${article.source}
URL: ${article.url}

以下のJSON形式のみで返してください（前後に説明文不要）:
{
  "trigger": "トリガーイベントの簡潔な説明",
  "chain": [
    {
      "step": 1,
      "event": "起きること",
      "reasoning": "なぜそうなるか",
      "confidence": 0.8,
      "sources": ["https://..."]
    }
  ],
  "narrative": "物語全体を2〜3文で要約"
}`

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
    tools: [{ type: 'web_search_preview' }],
    input: prompt,
  })

  const content = response.output_text
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('JSONの抽出に失敗しました')
  return JSON.parse(jsonMatch[0])
}
