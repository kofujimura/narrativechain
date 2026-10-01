import { signInWithGoogle } from '../auth/actions'

export const dynamic = 'force-dynamic'

const messages: Record<string, string> = {
  denied: 'このアカウントには閲覧権限がありません。',
  authentication: '認証に失敗しました。もう一度ログインしてください。',
  configuration: '研究サイトの設定が未完了です。管理者が設定を確認してください。',
}

const denialMessages: Record<string, string> = {
  user_email_mismatch: 'Googleが返したメールアドレスが許可設定と一致しません。アカウント選択を確認してください。',
  user_email_unconfirmed: 'メールアドレスの確認状態を取得できませんでした。',
  primary_provider_not_google: '旧バージョンの認可処理による拒否です。サーバーを更新してGoogleでログインし直してください。',
  google_only_identity_required: 'Google以外の認証IDが連携されています。この研究サイトはGoogle専用のため、連携状態の確認が必要です。',
  oauth_session_required: '今回のセッションは許可されたOAuth認証ではありません。Googleでログインし直してください。',
  session_claims_invalid: '認証セッションの確認情報が不足または不一致です。Googleでログインし直してください。',
  auth_session_verification_failed: 'Supabaseで認証トークンを検証できませんでした。',
  google_identity_missing: 'Supabaseのユーザー情報にGoogle IDがありません。',
  google_identity_email_mismatch: 'Google IDのメールアドレスが許可設定と一致しません。',
  google_identity_email_unverified: 'Google IDのメールアドレス確認済み情報を取得できませんでした。',
  auth_user_verification_failed: 'Supabaseで認証ユーザーを再確認できませんでした。',
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { error, reason } = await searchParams
  // Only fixed messages: URL query strings are not rendered verbatim.
  const details = error === 'denied' && reason && Object.hasOwn(denialMessages, reason) ? denialMessages[reason] : undefined
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-24">
      <p className="text-xs tracking-widest text-zinc-500">PRIVATE RESEARCH</p>
      <h1 className="mt-3 text-3xl font-bold">NarrativeChain</h1>
      <p className="mt-4 text-sm text-zinc-500">許可された研究者のみが閲覧できる個人用サイトです。</p>
      {error && <p role="alert" className="mt-6 text-sm text-red-600">{messages[error] || messages.authentication}</p>}
      {details && <p className="mt-3 text-sm text-zinc-500">{details}</p>}
      <form action={signInWithGoogle} className="mt-8">
        <button className="w-full rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Googleでログイン</button>
      </form>
      <p className="mt-6 text-xs text-zinc-500">認証しても、許可されていないアカウントでは研究データを取得できません。</p>
    </main>
  )
}
