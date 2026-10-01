# 本人専用の研究サイトの設定

公開するのはソースコードだけです。研究データは Google 認証・サーバー認可・Supabase RLS で保護します。実際の許可メールアドレス、Google Client Secret、秘密鍵をリポジトリに記載しないでください。以下のアドレスはすべて説明用の例です。

## 1. ローカル / Vercel の環境変数

Node.js 22.13 以上を使用します。Vercel の Root Directory は `frontend`、Framework は Next.js です。

```sh
cd frontend
npm ci
# .env.local がない場合だけコピー（既存の本人設定を上書きしない）
cp .env.example .env.local
```

すでに `.env.local` がある場合は上書きせず、不足する項目だけ編集してください。`.env.local` と `.env.*` は Git 管理対象外（`.env.example` は対象）です。

| 変数 | 設定場所 / 内容 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase の Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase の publishable key。旧 `NEXT_PUBLIC_SUPABASE_ANON_KEY` も利用可能 |
| `RESEARCH_ALLOWED_EMAIL` | 閲覧を許可する Google アカウントのメールを **1 件だけ**設定。サーバー専用。`NEXT_PUBLIC_` を付けない |
| `RESEARCH_SITE_URL` | 本番は `https://research.example.com` のようなサイトの origin。ローカルは `http://localhost:3000`。パス・クエリは不可 |

Vercel では Project Settings → Environment Variables に設定して再デプロイします。Production / Preview は意図して使う環境だけに設定します。未設定では閲覧を拒否します。フロントエンドには `SUPABASE_SERVICE_ROLE_KEY` を設定しません。

## 2. Supabase の DB / Storage を先に非公開化

本番へのコード反映より先に、Supabase SQL Editor で [`db/migrations/20261001_private_research.sql`](../db/migrations/20261001_private_research.sql) を実行します。現在のデータベースに `news_articles`、`trigger_events`、`causal_chains`、`chain_nodes` が必要です。不足するとトランザクション全体が失敗します。

この SQL は次を行います。

- 4 テーブルの RLS を有効化し、未認証者の権限とブラウザーからの更新権限を削除。
- 許可した Google アカウントだけが SELECT できる restrictive policy を追加。既存の「誰でも読める」permissive policy が残っていても、他アカウントを拒否。
- Data API に公開しない `research_private.owner_config` に 1 件の許可設定を保存する場所を作成。
- `research-artifacts` Storage bucket を private にし、本人だけに読み取りを許可。将来の HTML / JSON 登録用で、今回の既存ページがここに自動登録するわけではありません。
- サーバーの `service_role` 書き込みは維持。これは RLS を迂回する強い権限なので、ブラウザー・生成 HTML・Discord 投稿に渡さない。

続けて [`db/migrations/20261001_google_session.sql`](../db/migrations/20261001_google_session.sql) を実行します。すでに最初の SQL を適用済みなら、この追加 SQL だけで更新できます。ユーザー、許可メール設定、研究データは削除・変更せず、本人認可関数を置き換えます。両 SQL の適用順を逆にしないでください。

追加 SQL は今回の OAuth 認証（署名済み JWT の `amr`）・有効な `auth.sessions`・Auth 管理のセッション別 OAuth 記録・確認済み Google ID を検証します。Google 以外の連携 ID、メール / パスワード / OTP / 招待 / 回復によるログイン、失効したセッションを拒否します。最初に Email で登録したユーザーでも、その後 Google でログインし、確認済み Google ID が同じ本人メールに結び付いていれば許可します。

次に **Supabase SQL Editor 上だけで**、以下の例のメールを実際の許可メールに置き換えて実行します。実際の値を含む SQL をコミットしないでください。

```sql
insert into research_private.owner_config (singleton, email)
values (true, lower(btrim('researcher@example.com')))
on conflict (singleton) do update set email = excluded.email;
```

`RESEARCH_ALLOWED_EMAIL` と同じ値にしてください。設定がない / 両者が不一致 / RPC が未導入の場合はサイトが拒否します。変更後は既存のログインセッションでも毎リクエスト再確認します。

**注意：** この SQL が対象にするのは上記の 4 テーブルと専用 bucket です。他の public bucket、古い公開 HTML、別テーブル、ビュー、独自 RPC、Realtime Broadcast / Presence の公開設定は自動で保護しません。既存公開物・API を点検し、必要ならアクセスを停止してください。過去に公開した本文やキャッシュを「取り戻す」ことはできません。private に変更したファイルも、以前の配信 URL やキャッシュの残存に注意してください。

## 3. Google OAuth を設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成または選択し、Google Auth Platform の Branding / Audience / Data Access を設定します。
2. 個人 Google アカウントも使用するなら Audience は External を選択。Testing 運用では許可する本人を Test users に追加します。Internal は対象の Google Workspace 組織に限定されるので、使用可能な場合だけ選択します。
3. OAuth client を **Web application** として作成します。
4. Authorized redirect URIs に、Supabase Dashboard → Authentication → Sign In / Providers → Google に表示される **Supabase callback URL**（例：`https://your-project.supabase.co/auth/v1/callback`）を登録します。これは Vercel の `/auth/callback` とは別です。
5. Google の Client ID / Client Secret を Supabase の Google provider 設定へ貼り付けて有効化します。Google の秘密情報は Next.js のソースや公開環境変数に入れません。
6. Google Auth Platform → **Data Access（データアクセス）→ Add or remove scopes（スコープを追加または削除）** で `openid` を手動追加し、`https://www.googleapis.com/auth/userinfo.email` と `https://www.googleapis.com/auth/userinfo.profile` も確認します。後ろの 2 つは通常デフォルトで追加されています。不要な追加権限は要求しません。
7. Supabase → Authentication → URL Configuration で Site URL を本番の `RESEARCH_SITE_URL` と一致させます。Redirect URLs に本番の `https://research.example.com/auth/callback` と開発用の `http://localhost:3000/auth/callback` を個別登録します。ワイルドカードは避け、Preview を使う場合もその URL を個別追加します。
8. **この研究サイトの Supabase プロジェクトでは、有効な OAuth provider を Google だけにします。** JWT の `amr.method = oauth` は OAuth 利用を示しますが、Google / GitHub などの区別は持たないため、この設定は認可の前提です。Email / 他 provider / Anonymous sign-in / Manual identity linking も無効にしてください。別アプリで他の OAuth provider が必要な共有プロジェクトは、そのまま使用せず研究専用プロジェクトを分けてください。コードと DB は Google / Email 以外の連携 ID がある本人も安全側に倒して拒否します。

Google ログインで別アカウントの Supabase ユーザーが作成される可能性はありますが、作成されたことと研究データを読めることは別です。本人認可を通過しなければ DB とサイトの両方が拒否します。Google の Testing 設定だけをセキュリティ境界にしません。

公式手順：[Supabase Google 認証](https://supabase.com/docs/guides/auth/social-login/auth-google)、[SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[private Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals)。

## 4. 起動・動作確認

```sh
cd frontend
npm test
npm run typecheck
npm run lint
npm run build
npm run test:http
npm run dev
```

`http://localhost:3000` を開き、Google でログインします。設定が未完了ならデータは表示されません。

必ず次を確認してください。

1. シークレットウィンドウで `/` と `/story/<既存ID>` を直接開くとログイン画面に移動し、HTML / RSC 応答に本文が含まれない。
2. 本人の Google アカウントは一覧・詳細を閲覧できる。
3. 別 Google アカウントは拒否され、本人アドレスがエラーメッセージに表示されない。
4. publishable / anon key で DB を直接 SELECT しても取得できない。別アカウントの JWT を使っても研究行が 0 件。
5. private bucket の public URL が利用できず、別アカウントには download / list が許可されない。
6. ログアウト後は再読み込み・詳細の直リンクが拒否される。
7. Response の `Cache-Control` は `private, no-store`、`Vercel-CDN-Cache-Control` は `no-store`。認証済み HTML を共有キャッシュに保存しない。

`npm test` はポリシーの単体テストと、PGlite（PostgreSQL）による実際の RLS / ロールのテストです。Google / 本番 Supabase には接続しません。`npm run test:http` は事前の `npm run build` が不要です。ソースだけを UUID ごとの `.next-http-tests/` にコピーし、模擬設定で production build してから、ローカルのモック Auth / DB と Next.js でページ単位の認可を検証します。`.env*` はコピーせず、通常の `.next`・型設定・起動済み dev サーバーも変更しません。生成したテスト用フォルダーは終了時に削除します。Node.js 22.13 以上が必要です。実際の Google OAuth・Supabase Storage API は上の手動確認が必要です。

### HTTP テストの `307 !== 200` と開発サーバーの二重起動

以前の HTTP テストは通常の production build を再利用していました。`NEXT_PUBLIC_SUPABASE_*` のビルド時固定値がテスト用環境変数より優先され、模擬ユーザーが認識されず `/login` へ 307 リダイレクトする不具合がありました。現在はサーバー専用の動的環境変数読み取りと、上記の分離されたテスト用ビルドで修正しています。`whoami` の Mac ユーザー名は Google 認可に影響しません。

`Another next dev server is already running` は同じアプリの dev サーバーがすでに動いているという意味です。表示された既存 URL を使えば、もう一度 `npm run dev` を実行する必要はありません。自分の Terminal から起動し直す場合だけ、対象 PID / 作業ディレクトリを確認して既存プロセスを停止してください。

### Google ログイン後の `error=denied`

ログイン画面には拒否した条件の説明を表示します。URL の `reason=` とサーバーログには固定の診断コードだけを含め、メールアドレス・ユーザーID・認証コード・トークンは記録しません。`user_email_mismatch` はログインしたアカウントと許可設定の不一致、`google_identity_*` は Google ID の登録・メール一致・確認済み状態の不一致です。`oauth_session_required` は今回の認証方式が OAuth でない / 非許可の方式を含むこと、`session_claims_invalid` は検証済みトークンとユーザーの不一致・確認情報不足、`google_only_identity_required` は他 provider の ID が連携されていることを示します。

旧版の `primary_provider_not_google` は、`app_metadata.provider`（**最初の登録方法**）を今回のログイン方法として扱っていた実装の誤りです。手動 Email 登録後に Google が連携された本人も拒否していました。アプリの更新と追加 SQL の適用後、開発サーバーを再起動して Google でログインし直します。本人ユーザーの削除・メール確認状態や `app_metadata` の手動書き換えは不要です。追加 SQL が未適用なら旧 DB 判定が残り、`error=configuration` になります。

`reason` が付かない古い `error=denied` が続く場合、起動中の dev サーバーに古い処理が残っていないか確認し、対象 PID / ディレクトリを確かめて再起動してください。認可条件を推測で緩めないでください。

## 実装の範囲と制約

- 既存の Next.js 一覧・物語詳細を本人専用化します。local Studio（`npm start` / localhost:4317）はループバック専用の別アプリで、今回の Google 認証の対象ではありません。
- PKCE の Google 認証、HttpOnly / SameSite=Lax Cookie、本番 HTTPS の Secure Cookie、ログアウト、未設定時の拒否、サーバーによる `getUser()` 検証、DB 側本人 RPC を実装しています。リダイレクト先はサーバー設定だけを使用します。
- `getClaims()` で署名を検証した今回の OAuth 認証を確認し、`getUser()` の最新 Google ID と照合します。DB では同じ条件に加えて Auth 管理の有効セッションと OAuth 記録を確認します。`app_metadata.provider` / 編集可能な `user_metadata` / 未検証の JWT decode は認可根拠にしません。Google だけを OAuth provider として有効にする設定が必要で、複数 OAuth provider の共存をサポートする実装ではありません。
- ブラウザーの匿名 Realtime 購読は削除しました。新しい物語の確認はページを再読み込みしてください。
- コードを公開しても許可アカウントと研究データは含まれません。ただし、ログイン中のブラウザーには当然その本人向けのデータが届きます。
- Hermes 生成 HTML / JSON の登録 CLI と Vercel 表示ルートは未実装です。現在は従来の Supabase 物語を表示します。登録処理を追加する際も、取得 API の入口で `requireResearchOwner()` と private Storage を使用してください。任意 HTML はスクリプトを許可せず sandbox で分離します。
- 認証は転載許諾ではありません。元ニュース全文は利用条件・著作権を別途確認してください。共有する場合は、原文を含まない要約・必要な引用・出典 URL を基本とします。

設定変更は `.env.local` / Vercel / Supabase / Google 管理画面で行います。このリポジトリへ個人設定や秘密情報をコミットしないでください。

## 開発時の検証記録（2026-10-01）

ローカルの既存テスト 29 件、認可・PostgreSQL RLS・HTTP テスト 6 件が成功しました。型検査、lint、Next.js の production build も成功し、frontend の `npm audit` は既知の脆弱性 0 件でした。Git 公開対象のファイルに実際の許可メールが含まれないことを確認しました。Google OAuth の実サービス設定、クラウド DB への SQL 適用、Vercel デプロイは未実施です。

HTTP テスト修正後、frontend の単体 / RLS テスト 5 件と、分離された production build / HTTP テスト 2 件が成功しました。実際の認証設定を含む `.env.local` が存在する環境でも、HTTP テストに認証情報を持ち込みません。

Google 連携ユーザーの認可修正後、単体 / RLS 7 件と HTTP 2 件が成功しました。型検査、lint、分離した production build、`git diff --check` も成功しています。手動 Email 登録後の Google OAuth は許可し、同じ本人のパスワードログイン、別アカウント、偽造トークン、失効セッションは拒否する回帰テストを追加しました。公開対象ファイルに実際の許可メールがないことも再確認しました。

実サービスの Google ログインでアプリ側の本人・Google ID・OAuth トークン検証の通過を確認し、その後の DB 認可で `error=configuration` に停止しています。公開 Auth 設定の読み取りでは有効な OAuth provider は Google だけでした（Email は別途有効ですが今回の認可では拒否）。追加 SQL のクラウド適用と、その後の本人閲覧 / 他アカウント拒否の確認は未完了です。開発サーバーは更新済みコードで再起動しています。
