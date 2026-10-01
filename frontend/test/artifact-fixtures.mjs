export function storyPacket() {
  return { schema_version: 'narrative-investigation/v1', exported_at: '2026-10-01T00:00:00Z', story: {
    id: 'story-1', title: 'PRIVATE_ARTIFACT_SENTINEL', decision: 'story',
    facts: [{ id: 'F1', title: '公式発表', text: '実証計画が発表された。', url: 'https://example.com/news', source: 'Fixture', retrieved_at: '2026-10-01T00:00:00Z' }],
    confirmed_facts: [{ fact: '実証開始の計画', fact_ids: ['F1'] }],
    chain: [{ event: '実証', mechanism: '導入判断を可能にする', fact_ids: ['F1'], condition: '実証が成功する場合', refutation: '実証が中止される場合' }],
    narrative: 'PRIVATE_ARTIFACT_SENTINEL: 実証の成功を条件とする仮説。', questions: ['実証は成功したか？'], review: '受注は未確認。',
  } }
}
export function reportPacket() {
  return { schema_version: 'narrative-report/v1', demo: false, report: {
    summary: '受注先は未確認。', as_of: '2026-10-01', candidates: [], limitations: ['根拠不足'], next_questions: ['契約公表はあるか？'],
  } }
}
