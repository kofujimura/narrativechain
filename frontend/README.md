# NarrativeChain Private Research

Google 認証・サーバー認可・Supabase RLS により、非公開設定で指定した本人だけが研究データを読める Next.js サイトです。公開リポジトリに個人アカウント・秘密情報を含めません。

[Google アカウント・Supabase・Vercel の設定手順](../docs/PRIVATE_RESEARCH_SETUP.md)を先に実施してください。環境変数と DB の本人設定が一致しなければ閲覧を拒否します。Node.js 22.13 以上が必要です。

```sh
npm ci
# .env.local がない場合のみコピーし、非公開の設定値を記入
cp .env.example .env.local
npm test
npm run typecheck
npm run lint
npm run build
npm run test:http
npm run dev
```

Vercel の Root Directory は `frontend`。Google Client Secret は Supabase に設定し、frontend には publishable / anon key だけを使用します。`RESEARCH_ALLOWED_EMAIL` に `NEXT_PUBLIC_` を付けないでください。

既存の Supabase 物語一覧・詳細を表示します。Hermes のローカル HTML の自動アップロードは別工程です。新着はページの再読み込みで確認します。

`npm run test:http` はテスト専用のソースコピーを自動ビルドするため、事前の `npm run build` は不要です。実際の `.env.local`・Google アカウント・Supabase に依存せず、起動中の開発サーバーとも干渉しません。開発サーバーがすでに起動している場合は、その URL を使用してください。
