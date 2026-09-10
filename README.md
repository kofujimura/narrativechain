# NarrativeChain

## ローカル物語・調査スタジオ

`npm run local:start` で [http://localhost:4317](http://localhost:4317) を開きます。URL・HTML・テキスト・複数ファイルからインパクト選別と物語生成を行い、「調査する」でCodex CLIへJSONを渡して根拠付きレポートを表示します。本番DBとは独立しています。[使い方・単体CLI・制約](local/README.md)を参照してください。

## 投資仮説の研究・バックテスト

3テーマ（再生可能エネルギー、健康・医療、AI・情報処理）の実験はローカルの `research/` に保存しています。このフォルダ全体はGit管理対象外です。新規チェックアウトには含まれません。ローカル版の実行コード・プロンプト・テストは `local/` に独立させています。

研究フォルダが手元にある環境では `npm run research:status` で実行結果を確認できます。`research:*` コマンドは個人実験用です。通常の検証は `npm test`。2026-09-10にインパクト選別と「該当なしなら生成しない」制御を本番コードにも追加しました（サービス未起動）。

ニュースから将来予測の物語を自動生成するシステム。GPT-5.6 Solがニュースのトリガーイベントを起点に因果連鎖を推論し、複数ステップの予測物語を生成する。

**例：**
> ホルムズ海峡封鎖 → ナフサの不足 → 廃プラスチックの再利用が注目される → 再生プラスチック企業の評価が高まる

## アーキテクチャ

```
[このマシン / PM2]               [Supabase]          [Vercel]
  RSSインジェスタ       →→→    中央DB        →→→   Next.js
  (30分ごと)                                   ←←←   Realtime購読
  重要度フィルタ        →→→
  (1時間ごと・適格記事から最大1件、該当なしは生成しない)
  因果チェーン生成      →→→
```

## 技術スタック

| 役割 | 技術 |
|------|------|
| LLM | OpenAI GPT-5.6 Sol（環境変数で変更可能） |
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
OPENAI_MODEL=gpt-5.6-sol
OPENAI_FILTER_MODEL=gpt-5.6-sol
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
│   ├── importanceFilter.js  # 日本企業へのビジネスインパクトスコアリング
│   └── causalChain.js       # 因果チェーン生成
├── db/
│   └── supabaseClient.js    # Supabase読み書き
├── main.js                  # エントリーポイント
├── frontend/                # Next.js アプリ
└── SPEC.md                  # 詳細仕様書
```

## 処理フロー

1. **インジェスタ**（30分ごと）：5つの国内RSSフィードから最新ニュースを取得しSupabaseに保存
2. **社会・産業インパクトフィルタ**（1時間ごと）：新規性・変化の大きさ・波及範囲・裏付けを各0〜3で評価し、全軸2以上かつ情報十分な実質的変化だけ通過。通過記事から最大1件を選び、該当なし・情報不足なら物語生成/物語保存はゼロ。同点可。入力内の根拠抜粋を照合する。8記事以内のバッチ内は意味的重複、バッチ間は同一URL等の完全重複だけを除く。新しい判断規則は仮基準で、精度評価済みの閾値ではない。
3. **因果チェーン生成**：ニュースからトリガーイベントを抽出し、4〜6ステップの因果連鎖を生成（必要に応じてWeb検索）
4. **フロントエンド**：Supabase Realtimeで新着物語を自動表示

## 単体テスト

重要度フィルタのみを単独で動作確認する：

```bash
# 直近4時間・上位3件（デフォルト）
node test_importanceFilter.js

# 時間範囲と件数を指定
node test_importanceFilter.js 12 5   # 直近12時間・上位5件
```
