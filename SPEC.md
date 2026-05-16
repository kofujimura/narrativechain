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
  Importance Filter GPT-5.5で日本企業へのビジネスインパクトをスコアリング
                    1時間ごとに上位1件を選出（直近4時間のスライディングウィンドウ）
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
│   ├── importanceFilter.js  # GPT-5.5で日本企業へのビジネスインパクトをスコアリング
│   └── causalChain.js       # GPT-5.5でトリガー抽出＋因果チェーン生成
├── db/
│   └── supabaseClient.js    # Supabase読み書き
├── main.js                  # エントリーポイント（ニュース取得: 30分ごと / 分析: 1時間ごと）
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

| ソース | カテゴリ |
|--------|---------|
| NHK総合 | politics |
| NHK経済 | finance |
| 朝日新聞 | politics |
| Yahoo!ニュース | politics |
| 毎日新聞 | politics |

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
- 重要度スコアリング＆分析実行：**1時間ごと**
- 1日の分析件数目安：**約24件/日**

### スライディングウィンドウ
- 毎時間、**直近4時間**に取得した記事を対象にスコアリング
- 過去に選出済みの記事はメモリ上のMapで管理し除外する
- 選出済みIDは4時間経過後にメモリから自動削除する

### スコアリング方法

直近4時間に取得したニュース（選出済み除外後）をバッチでGPT-5.5に送り、**日本企業へのビジネスインパクトを0〜99**で評価。上位1件をCausal Chain Agentへ渡す。

```
80〜99: 特定業種の日本企業に影響（半導体・エネルギー・金融・情報・医療分野の企業提携や新技術・規制変更など）
60〜79: 日本企業全体の収益・競争力・サプライチェーンに影響（為替の急激な変動・主要原材料の価格高騰）
40〜59: 間接的に日本企業へ波及しうる海外の政治・経済動向
20〜39: 日本企業への影響が限定的・短期的にのみ関係しうる話題
 0〜19: 日本企業とほぼ無関係・事件・スポーツ・芸能・純粋なローカルニュース
```

### 重複排除
同じ出来事を複数ソースが配信した場合、LLMへのプロンプト指示によりスコアが最も高い1件のみ残す。

複数ニュースをまとめてバッチ送信することでAPI呼び出しを1回に抑える。

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
