# NarrativeChain - 仕様書

## プロジェクト概要

ニュースから将来予測の物語を自動生成するシステム。  
LLMがニュースのトリガーイベントを起点に、因果連鎖を推論し、複数ステップの予測物語を生成する。

**例：**
> ホルムズ海峡封鎖 → ナフサの不足 → 廃プラスチックの再利用が注目される → 再生プラスチック企業の評価が高まる

---

## システム構成

```
【このマシン (24時間稼働 / PM2管理)】
  Ingestor          RSSフィードから新着ニュース取得（30分ごと）
       ↓
  Importance Filter GPT-5.5で世界経済影響度をスコアリング
                    4時間ごとに上位3件を選出
       ↓
  Causal Chain Agent GPT-5.5で因果チェーンを生成・スコアリング
                     （トリガー抽出も兼務）
       ↓
  Supabase書き込み

【Supabase】
  中央DB（このマシンが書き込み、Vercelが読み取り）

【Vercel (Next.js)】
  Supabaseから最新データを取得して表示するのみ
  Supabaseリアルタイム購読で自動更新
```

---

## 技術スタック

| 役割 | 技術 |
|------|------|
| LLM | OpenAI GPT-5.5 |
| Web調査 | OpenAI Responses API `web_search_preview`（GPT-5.5のtoolとして使用） |
| バックエンドワーカー | Node.js + PM2 |
| データベース | Supabase |
| フロントエンド | Next.js (App Router) / Vercel |
| RSSパース | rss-parser (npm) |
| プロセス管理 | PM2 |

---

## バックエンドワーカー構成（このマシン）

```
narrativechain/
├── ingestor/
│   └── fetchNews.js         # RSSフィード取得（重複排除はSupabaseのurl unique制約で対応）
├── agents/
│   ├── importanceFilter.js  # GPT-5.5で世界経済影響度スコアリング
│   └── causalChain.js       # GPT-5.5でトリガー抽出＋因果チェーン生成
├── db/
│   └── supabaseClient.js    # Supabase読み書き
├── main.js                  # エントリーポイント（ニュース取得: 30分ごと / 分析: 4時間ごと）
├── .env                     # APIキー類
└── package.json
```

**PM2起動：**
```bash
pm2 start main.js --name narrativechain
pm2 save
pm2 startup
```

---

## ニュースソース

現在使用しているRSSフィード（`ingestor/fetchNews.js`）：

| ソース | カテゴリ | リスク |
|--------|---------|--------|
| BBC Business | finance | low |
| BBC World | politics | low |
| Financial Times | finance | low |
| Al Jazeera | politics | medium |
| NPR News | politics | low |
| NYT World | politics | low |
| NYT Business | finance | low |

**取得方法：**
- `rss-parser` でサーバーサイドパース
- 1フィードあたり最新5件を取得
- 失敗時は5分クールダウン

---

## データモデル（Supabase）

```sql
news_articles
  id            uuid primary key
  title         text
  body          text
  url           text unique
  source        text
  category      text
  published_at  timestamptz
  fetched_at    timestamptz

trigger_events
  id            uuid primary key
  article_id    uuid references news_articles
  summary       text
  category      text
  created_at    timestamptz

causal_chains
  id              uuid primary key
  trigger_event_id uuid references trigger_events
  depth           int
  score           float
  created_at      timestamptz

chain_nodes
  id              uuid primary key
  chain_id        uuid references causal_chains
  step_number     int
  event_text      text
  reasoning       text
  confidence_score float
  sources         text[]   # web_search_previewで参照した引用URL
```

---

## Importance Filterの動作設計

### 処理タイミング
- ニュース取得：30分ごと（常時）
- 重要度スコアリング＆分析実行：4時間ごと
- 1日の分析件数目安：3件 × 6回 = **18〜20件/日**

### スコアリング方法

直近4時間に取得したニュースをバッチでGPT-5.5に送り、世界経済への影響度を0〜10で評価。上位3件をCausal Chain Agentへ渡す（スコア閾値なし）。

```
10:   世界規模の金融危機・大国間の戦争勃発・主要国の政権崩壊
8〜9: 主要国の重大な政策転換・大規模な資源供給障害
6〜7: 複数国に影響する政治・経済イベント
4〜5: 単一国内の政策変更・地域経済への影響
2〜3: 限定的・局所的な影響
0〜1: 世界経済と無関係
```

複数ニュースをまとめてバッチ送信することでAPI呼び出しコストを削減する。

---

## Causal Chain Agentの動作設計

```
[入力] ニュース記事（タイトル・本文・出典・URL）
  ↓
Step 1: トリガーイベントを抽出（trigger フィールド）

Step 2: 世界経済に波及する因果連鎖を4〜6ステップで推論
  ※ 必要に応じてweb_search_previewで最新情報を調査

Step 3: 各ステップをスコアリング
  → 蓋然性（confidence）を0〜1で付与

Step 4: 結果をSupabaseに保存
  → trigger_events / causal_chains / chain_nodes
  → 引用元URLも chain_nodes.sources に記録
```

### Web Search の利用方針

- GPT-5.5の `web_search_preview` ツールをOpenAI Responses APIで渡す
- モデルが「最新情報が必要」と判断したときのみ自律的に呼び出す

```javascript
const response = await openai.responses.create({
  model: 'gpt-5.5',
  tools: [{ type: 'web_search_preview' }],
  input: prompt,
})
```

---

## フロントエンド構成（Vercel）

```
frontend/
├── app/
│   ├── page.tsx                   # 物語一覧（新着順・SSR）
│   ├── components/
│   │   └── StoryList.tsx          # カード一覧（Supabase Realtime購読）
│   └── story/[id]/page.tsx        # 物語詳細（因果チェーンをタイムライン表示）
└── lib/
    └── supabase.ts                # 読み取り専用クライアント＋型定義
```

- Supabaseリアルタイム購読により、新しい物語が生成されると自動更新
- 物語はタイムライン形式で表示
- 各ノードに確信度バーと引用URL表示

---

## 開発フェーズ

| フェーズ | 内容 | 状態 |
|---------|------|------|
| **Phase 1** | Causal Chain AgentのコアロジックをCLIで動作確認 | 完了 |
| **Phase 2** | Supabaseスキーマ設計 + 書き込み処理 | 完了 |
| **Phase 3** | RSSインジェスタ + PM2による自動化 | 完了 |
| **Phase 4** | Next.jsフロントエンド（物語の表示UI） | 完了 |
