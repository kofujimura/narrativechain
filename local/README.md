# NarrativeChain Local Studio

ローカル専用の「ニュース → 物語 → 気になった仮説だけ調査する」Webアプリです。本番のNext.js・Supabase・定期収集ワーカーから独立し、Node.jsの標準機能で動きます。必要な生成結果だけ本人専用 Vercel サイトに JSON 登録する任意の [登録CLI](../docs/PUBLISH_RESEARCH.md)もあります。ローカル生成には登録先への接続は不要です。

## 起動と操作

Node.js 22以上と、**ChatGPTでログイン済みのCodex CLI**が必要です。選別・物語生成・実調査の標準方式はすべてサブスクリプション利用枠です。OpenAI APIキー・Supabaseは不要です。未ログインなら `codex login` を実行してください。

```sh
npm run local:start
# npm start でも同じローカル版を起動します。
```

[localhost:4317](http://localhost:4317) を開きます。ポート変更は `NARRATIVE_PORT=4318 npm run local:start`。

1. URLを1行ずつ、本文/HTMLを貼り付け、または複数の `.txt` / `.md` / `.html` / `.json` ファイルを選択します。合わせて1〜6件です。JSON入力は `{ "title": "見出し", "body": "ニュース本文…" }` または `facts` 配列に対応します。
2. 実行方式「Codex / ChatGPTサブスク枠（標準）」で、外部送信できる本文と利用枠消費への同意を確認して「物語をつくる」。低インパクト・情報不足なら見送り、通過0件なら物語生成を呼びません。複数ニュースをまとめるオプションもありますが、関連が弱ければ生成を見送ります。
3. 物語・成立条件・反証・質問を読み、「調査する」。別の確認画面でCodex利用枠の消費に同意すると調査CLIが動きます。架空のデモ調査も選択できます。
4. イベントログと、出典付きHTMLレポートが画面下部に表示されます。「保存した処理」から結果を再表示できます。

保存済みサンプルの閲覧は追加通信・課金なしです。サンプルは既存の `research/data/impact-samples/v1/report.json` がある場合に表示されます。

Codexの物語生成は `NARRATIVE_MODEL`、選別は `NARRATIVE_FILTER_MODEL`（未設定なら `NARRATIVE_MODEL`）で上書きでき、既定モデルは `gpt-6.1-sol` です。両処理の推論量は `low` です。設定はプロセス環境変数、`research/.env.local`、`.env.local`、`.env` の順に読みます。共通の既定値は `agents/modelConfig.js` にあります。変更後はサーバーを再起動してください。

API従量課金は画面で「OpenAI API」を選び、別途API課金への同意をチェックした場合だけ実行します。`NARRATIVE_LLM_BACKEND=api` を明示した場合はAPIモードを初期選択しますが、同意は必要です。APIキーがあるだけではAPIを選びません。APIモード専用の `OPENAI_FILTER_MODEL` / `OPENAI_MODEL` も未設定時 `gpt-6.1-sol` です。

CLI調査も `gpt-6.1-sol` を既定にし、Codexへ `--model` を渡します。変更する場合はプロセス環境変数 `NARRATIVE_RESEARCH_MODEL` を指定します。調査の推論量は従来どおりCodexの既定設定に従います。

## システム構成

```text
ブラウザー: URL / 本文 / ファイル
  → localhost Nodeサーバー: 本文抽出
  → Codex CLI（ChatGPTログイン）: インパクト選別 → 適格記事の物語生成
  → 物語カード: 「調査する」 / JSONエクスポート
  → 独立Node CLI → Codex CLI（Web調査・構造化JSON）
  → JSON検証 → エスケープ済みHTML → sandbox iframe
```

サーバーを起動したTerminalにもログが出ます。調査は子CLIプロセスとして実行され、別のTerminal.appウィンドウを自動で開く構成ではありません。[agentcast](https://github.com/kofujimura/agentcast) の「実行ログとHTML成果物を並べる」構成を参考にしました。今回は外部中継サービスを使わず、ローカル保存とポーリングで表示します。

## 単体CLI・スキル

### ニュースからHTMLまで

```sh
npm run skill:install
npm run narrative -- --input local/fixtures/medical-news.html --output local/data/my-new-stories --ack-usage
```

`--input` は複数指定可能で、`--url https://…` も受け付けます。`--combine` で適格ニュースをまとめます。毎回新しい出力先を指定してください。`result.json`、`stories.html`、各物語の調査用 `story-N.json` を保存します。

Codexから `$narrative-story このニュースから物語を作り、HTMLで返してください` と依頼できます。Skill内では**現在のCodexが直接**選別・生成を担当します。ヘルパーの `--prepare` → `--plan` → `--render` はAIを呼ばず、入力抽出・判定の検証・安全なHTML化だけを行います。これによりSkill内でさらにCodexを起動する二重実行を避けます。この直接方式は呼び出し元Codexのモデル・認証・利用枠に従います（APIキーで起動した親エージェントはSkillでもAPI課金です）。

Terminalからの単体実行とWeb画面では、同じSkillの規則とJSONスキーマを渡して `codex exec` を起動します。ChatGPTログインを確認し、OpenAIプロバイダー・ChatGPT認証を明示、APIキー等を子プロセスに渡しません。利用上限・ログイン・モデルアクセスエラーでは停止し、APIモードへ自動切替しません。選別/各物語は最大3分、Webの1ジョブは最大10分です。自動再試行しません。

単体CLIでAPIを選ぶ場合は `--backend api --ack-api-cost` が必要です。`--ack-usage` だけではAPI課金に同意したことになりません。

### 物語から詳細調査へ

カードの「JSONを保存」で入力を保存して実行します。出力先は毎回新しいディレクトリを指定してください。

```sh
npm run investigate -- --input /absolute/path/story.json --output /absolute/path/new-report --ack-usage
```

通信なしの架空デモは `--ack-usage` を `--demo` に置き換えます。出力は `report.json`、`report.html`、`events.jsonl` と入力・スキーマです。

```sh
npm run skill:install
node ~/.codex/skills/narrative-investigation/scripts/investigate.mjs --input /absolute/path/story.json --output /absolute/path/new-report --ack-usage
```

インストーラーはリポジトリ内の `narrative-story` と `narrative-investigation` へのシンボリックリンクを作ります。既存の別スキルは上書きしません。登録後はCodexの新しいセッションで使用してください。リポジトリを移動した場合はリンク先を確認してください。

スキルは一次資料から発注・供給関係、上場主体、テーマ純度、年間案件寄与、因果距離、代替・反証を調査します。初回は最大2候補・5分、6件の絞った検索を指示し、未確認なら停止します。Webツールイベント数にも上限を設けていますが、1イベントに複数クエリが含まれる場合があります。内製・海外調達・既存設備での代替も検討し、受注の推測や根拠のない純度計算を避けます。

## 費用・保存・再開

標準方式ではニュース本文・調査用JSONがCodexを通じてOpenAIへ、調査の検索語が検索サービスへ送信されます。APIモードではニュース本文がOpenAI APIへ送信されます。localhostで動くことは、データが完全オフラインであることを意味しません。機密情報・権利のない本文を入力しないでください。

- 標準の生成・調査: ChatGPT/Codex利用枠を共有します。使えるモデルと利用上限は契約・アカウントに依存し、無制限ではありません。API予算台帳は変更しません。[公式の認証方式](https://learn.chatgpt.com/docs/auth#openai-authentication)と[非対話実行](https://learn.chatgpt.com/docs/non-interactive-mode)に基づく、個人のローカル利用です。
- 明示選択したAPI生成のみ: `OPENAI_API_KEY` とモデル設定を環境変数、`research/.env.local`、`.env.local`、`.env` の順に探します。既存研究予算ディレクトリがあれば `research/data/llm-budget/ledger.json` と許可設定を継続使用し、既存支出や不明予約をリセットしません。研究フォルダのない新規環境では `local/data/llm-budget/` を使い、利用同意後の最初の要求で台帳を作成します。いずれも累計上限1,600円相当です。Solの1要求の保守的な予約上限は100円相当（既存モデルは50円）で、利用トークン数から精算します。不明な課金予約は消さず、自動再試行しません。
- GPT-6.1 Solの料金は2026-10-01に[公式リリース情報](https://developers.openai.com/api/docs/changelog#september-2026)で入力2ドル/出力10ドル（各100万トークン、標準処理・272K以下の入力）を確認し、キャッシュ書込の1.25倍を入力全体に保守的に適用します。長文の割増も考慮し、換算には従来の200円/ドル×1.2の余裕を使います。請求額そのものではありません。旧モデルの価格表も明示的な上書きと保存済み利用量のために残しています。旧GPT-5.6 Solの確認期限2026-11-21による停止は、そのモデルを明示した場合にだけ適用されます。
- 調査: APIキーを子Codexに渡さず、ChatGPTログインだけを許可します。APIキーでのCodexログインでは停止します。上記API台帳には含まれません。
- `local/data/jobs/<id>/` に入力、ジョブ状態、ログ、結果を保存します。生成の本文抽出・選別結果も途中保存します。これらと研究データはGit対象外なので、環境移行時は別途バックアップしてください。
- `research/` 全体はGit対象外です。必要な実行コード・プロンプト・通常テストは `local/` にあり、研究フォルダなしでも起動できます。別環境へ移す場合、予算継続のため既存台帳・設定もコピーし、新規予算として始め直さないでください。
- 再起動時は実行中ジョブを中断扱いにし、勝手に再実行しません。中止・失敗も保存します。履歴閲覧だけでは再課金しません。

## 安全性と現在の制約

127.0.0.1のみで待受け、Host/Origin/セッショントークンを検証します。URL取得では内部IP・認証付きURL・独自ポートを拒否し、DNS検証済みIPへ接続、リダイレクトも再検証します。取得HTMLやAIの文字列を実行しません。子Codexはread-only、shell・アプリ・プラグイン・追加エージェント等を無効にし、ニュースを指示として扱わないよう設定しています。生成ではWeb検索も無効です。対話中の直接Skillでは親Codexの権限が適用されます。

個人localhost向けMVPです。LAN公開・ポート転送・リバースプロキシ経由で公開しないでください。URL取得はUTF-8の静的HTML/テキストが中心で、PDF、JS描画、ログイン、有料壁、アクセス制限回避には非対応です。本文上限は各24,000文字、HTTP取得上限1MBです。単一ジョブだけ実行でき、企業横断の網羅調査・売買機能はありません。

生成した物語は未検証の仮説です。独立した品質審査を毎回自動実行するものではありません。調査は現在の資料を使い、過去時点バックテストと区別します。純度や寄与は期間・会計範囲・単位・出典が揃う場合だけ比率を表示し、不明は0ではなく算定不可です。出典の誤読・抜けの可能性は残ります。

## 検証

```sh
npm run local:test
npm test
```

`node local/smoke-research.js` は実際にCodex利用枠を消費するライブ検証です。通常のテストには含めません。

2026-09-10、保存済み風力物語から実CLI調査が完走し、画面へのHTML埋め込みを確認しました。ジョブ `3d74c1cd-afc5-48f6-b50d-153f0641bfa4`。これは接続・動作の確認であり、投資成績や調査精度の証明ではありません。ブラウザーの複数ファイル選択は自動操作権限で停止したため、ファイル選択から送信までの手動確認が残ります（複数形式の本文処理は自動テスト済み）。

公開NEDO URLからの生成も画面操作で成功しました。生成ジョブ `eb49a1a9-d006-441f-ae59-e1318d201d9e`、1件通過・1物語、約23秒・2 API呼び出しで1.45014円相当。API研究累計129.43446円相当です。ローカル8件＋既存研究152件＝160テスト成功。これらは同じ既知事例を使った動作確認で、未使用標本による品質評価ではありません。

登録済みスキルのパスからの単体CLIも通信なしデモで成功しました。画面の「調査する」→確認ダイアログ→デモCLI→HTML表示はジョブ `0773b607-232a-4261-a6fc-d07bb1998d37` で確認済みです。履歴を実調査から生成へ切り替えると、旧レポートのiframeが非表示かつURL解除になることも確認しています。

同日、両モデルのSolデフォルト化・research非依存化後の通常テスト21件が成功。上記ライブ生成は変更前のモデルによる記録で、Solによる追加API実行は行っていません。

2026-10-01、サブスク標準化後の自動テスト29件と両Skillの構造検証が成功。ChatGPTログイン・`gpt-6.1-sol` の実CLIで医療ニュース1件が選別を通過し、物語1件・調査用JSON・HTMLを生成しました。保存先は `local/data/story-smoke-20261001-subscription-network/`。選別と生成の2回をCodexで実行し、API予算台帳は前後とも136.60866円相当で変化していません。制限付き環境での最初のCLI起動は終了コード1で停止し、出力を保存したまま、通信を許可した別出力先で動作確認しました。Web画面も「Codex / ChatGPTサブスク枠（標準）」「ChatGPTログイン済み」の表示を確認しています。既知の要約事例を使った接続確認であり、独立標本による物語品質の評価ではありません。
