# NarrativeChain

ニュースから将来予測の物語を自動生成するシステム。GPT-5.5がニュースのトリガーイベントを起点に因果連鎖を推論し、複数ステップの予測物語を生成する。

**例：**
> ホルムズ海峡封鎖 → ナフサの不足 → 廃プラスチックの再利用が注目される → 再生プラスチック企業の評価が高まる

## アーキテクチャ

```
[このマシン / PM2]          [Supabase]          [Vercel]
  RSSインジェスタ    →→→    中央DB        →→→   Next.js
  (30分ごと)                               ←←←   Realtime購読
  重要度フィルタ     →→→
  (4時間ごと・上位3件)
  因果チェーン生成   →→→
```

## 技術スタック

| 役割 | 技術 |
|------|------|
| LLM | OpenAI GPT-5.5 |
| Web調査 | OpenAI `web_search_preview` |
| バックエンド | Node.js + PM2 |
| データベース | Supabase |
| フロントエンド | Next.js 16 (App Router) / Vercel |

## セットアップ

### バックエンド

```bash
npm install
cp .env.example .env  # APIキーを設定
```

`.env` に以下を設定：

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

PM2で起動：

```bash
pm2 start main.js --name narrativechain
pm2 save
pm2 startup
```

### フロントエンド

```bash
cd frontend
npm install
```

`frontend/.env.local` に以下を設定：

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

開発サーバー起動：

```bash
npm run dev
```

## ディレクトリ構成

```
narrativechain/
├── ingestor/
│   └── fetchNews.js         # RSSフィード取得
├── agents/
│   ├── importanceFilter.js  # 世界経済影響度スコアリング
│   └── causalChain.js       # 因果チェーン生成
├── db/
│   └── supabaseClient.js    # Supabase読み書き
├── main.js                  # エントリーポイント
├── frontend/                # Next.js アプリ
└── SPEC.md                  # 詳細仕様書
```

## 処理フロー

1. **インジェスタ**（30分ごと）：7つのRSSフィードから最新ニュースを取得しSupabaseに保存
2. **重要度フィルタ**（4時間ごと）：直近のニュースをGPT-5.5でスコアリングし上位3件を選出
3. **因果チェーン生成**：各ニュースからトリガーイベントを抽出し、4〜6ステップの因果連鎖を生成（必要に応じてWeb検索）
4. **フロントエンド**：Supabase Realtimeで新着物語を自動表示
