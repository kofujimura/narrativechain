# 生成結果を本人専用サイトに登録する

Hermes / Codex の `$narrative-story` が出力する `story-N.json` と、`$narrative-investigation` の `report.json` を保存します。HTML・ログ・認証情報はアップロードしません。Vercel は検証済み JSON からローカル版と共通のレンダラーで HTML を再生成し、本人だけに表示します。登録処理は生成AIを呼ばず、OpenAI API 課金は発生しません。Supabase / Vercel の利用枠は別です。

## 初回設定

1. [本人限定認証](PRIVATE_RESEARCH_SETUP.md)を設定し、本番に反映します。既存の Google セッション SQL まで適用してください。
2. Supabase SQL Editor で [`20261001_research_documents.sql`](../db/migrations/20261001_research_documents.sql)を適用します。新テーブルのみを追加し、従来の物語は削除しません。
3. CLI を使う場合、Supabase Authentication → URL Configuration → Redirect URLs に **`http://localhost:4318/callback`** を追加します。Google Cloud の callback ではなく Supabase 側の許可リストです。
   本番 Web 用には Site URL を本番 origin、Redirect URLs を **`https://research.example.com/auth/callback`** に設定します。Web のログイン後に localhost へ戻る場合、本番 callback が未登録または一致していない可能性があります。CLI callback の登録だけでは Web 用の設定を代替できません。
4. リポジトリのルートで `npm ci`。Node.js 22.13 以上を使用します。

## Web から取り込む

本人でログインし、`/research` →「JSONを取り込む」で JSON ファイル（240KB以内）を選びます。従来の RSS 物語は `/` に残ります。HTML ファイルや複数物語を含む `stories.json` は受け付けません。物語ごとの `story-N.json` を使ってください。

## CLI / Hermes から登録する

サイトの origin は明示指定します。以下のサイト名とパスは説明用です。

```sh
npm run publish -- login --site https://research.example.com
npm run publish -- publish --site https://research.example.com --input /absolute/path/story-1.json
```

初回 login は Terminal を待機させ、Google ログインをブラウザーで開きます。本人認可を確認してからローカルにセッションを保存します。`localhost:4318` を使用するため、CLI は生成スキルと同じマシン、またはそのマシンで開けるブラウザーで実行してください。通常のサイト閲覧とは別のログインです。別アカウントでは保存できません。

認証ファイルの標準位置は Git 対象外の `local/data/publisher-auth.json`、権限は `0600` です。**アクセス / 更新トークンが含まれるため、エージェントのコンテキストや Discord、ログ、リポジトリに貼り付けないでください。** CLI が内部で読み、期限が近ければ通常のセッション更新を行います。別サイトに送信しません。`--auth-file /absolute/private/path.json` でサイトごとに分けられます。認証エラー時の再 login は人が行ってください。紛失時は Supabase で該当セッションを失効させます。

成功時は ID と本人専用ページ URL だけを返します。同じ JSON・同じ関連先は重複せず、既存 URL を返します。書き換え・削除機能はありません。エラー時に自動再試行、API課金、別アカウントへの切り替えはしません。

## 調査レポートを物語に関連付ける

物語ページで「調査用JSONを保存」し、Terminal / Hermes の `$narrative-investigation` に渡します。調査結果は以下で登録できます。

```sh
npm run publish -- publish --site https://research.example.com --input /absolute/path/report.json --parent <物語のUUID>
```

または物語ページの「この物語の調査結果を登録」から Web 取り込みします。`--parent` は元の物語の UUID であり、ファイル内の `story-1` ではありません。関連先は DB で再確認します。Vercel 上では Terminal エージェントを起動しません。調査は手元のサブスク実行のままです。

デモレポートを登録する場合は `{ "schema_version": "narrative-report/v1", "demo": true, "report": <report.jsonの内容> }` の形式にして、実調査と区別してください。

## 保護と制約

- API と Server Action の各入口で本人認証し、DB 側でも Google セッションの RLS を適用します。service-role key は不要です。
- JSON の型・大きさ・根拠 ID・URL を検証し、本文をエスケープ。iframe はスクリプト / 同一 origin 権限なし。外部の根拠リンクのみ別タブで開けます。
- 本文、ダウンロード、エラーは共有キャッシュに保存しません。公開 Auth 設定 API が返すのは Supabase URL と publishable key だけです。
- ローカル CLI の出力 HTML そのものを配信する仕組みではありません。データを登録して同じ見た目を再生成します。既存スキーマに合わない独自 HTML は非対応です。
- 認証を付けても著作権・利用規約が消えるわけではありません。入手元が許可する範囲の研究利用に限定してください。

## 開発時の検証（2026-10-01）

ローカル 32 件、frontend の認証・JSON・PostgreSQL RLS 10 件、分離した production build と実 HTTP 2 件が成功。HTTP テストでは未認証 / 他ユーザー / 偽造トークンの拒否、本人の登録・重複排除・ダウンロード、Web の Server Action の本人認可、調査と物語の関連付けを確認しています。CLI の模擬 PKCE テストでは本人認可後だけ認証情報を `0600` で保存し、拒否・時間切れ時は保存しないことを確認しています。型検査・lint・両スキルのバリデーションも成功しました。これらはクラウドでの本人閲覧確認とは別の検証です。

本番へのコード・環境設定反映後、実際の本人 Google PKCE ログインと CLI の物語登録が成功。同じ物語の再登録は重複を作らず同じ URL を返しました。登録済み物語は匿名の Web ページから307、JSON APIとSupabase直接アクセスから401で拒否され、本文は返りませんでした。Supabase の本番callback設定後、本番 Web の本人ログイン、保存一覧、物語本文・条件・反証の HTML 表示、調査用 JSON のダウンロードを確認しました。ダウンロードした JSON は元の生成物を正規化した内容と完全に一致しました。クラウドでの調査レポート登録と他アカウントの実ログインは未実施です。
