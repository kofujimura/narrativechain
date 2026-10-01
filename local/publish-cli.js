#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, lstat } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeArtifact, MAX_ARTIFACT_BYTES, validDocumentId } from '../frontend/lib/artifact-format.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultAuthFile = join(root, 'local/data/publisher-auth.json')
export function siteOrigin(site) {
  const u = new URL(site)
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) throw Error('--site はHTTPSのorigin（ローカルはHTTP可）を指定してください。')
  return u.origin
}
async function jsonResponse(response) {
  if (!response.ok) throw Error(`登録サイトのHTTP ${response.status}。ログイン・本人設定・追加SQLを確認してください。自動再試行しません。`)
  const text = await response.text()
  if (text.length > 100000) throw Error('登録サイトからの応答が大きすぎます。')
  return JSON.parse(text)
}
async function privateFile(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0) || info.size > 100000) throw Error('認証ファイルは本人のみ読み書き可能な通常ファイル（0600）にしてください。')
  return JSON.parse(await readFile(path, 'utf8'))
}
async function saveAuth(path, data) {
  try { await privateFile(path) } catch (e) { if (e.code !== 'ENOENT') throw e }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}
async function authorized(credentials, site, fetchImpl = fetch) {
  const response = await fetchImpl(`${site}/api/research/auth`, {
    headers: { Authorization: `Bearer ${credentials.session.access_token}` }, redirect: 'manual', signal: AbortSignal.timeout(15000),
  })
  const result = await jsonResponse(response)
  if (result.authenticated !== true) throw Error('本人のGoogle認証を確認できません。')
}

export async function loginPublisher({ site, authFile = defaultAuthFile, timeoutMs = 180000, log = console.log, openBrowser = true }) {
  site = siteOrigin(site)
  const config = await jsonResponse(await fetch(`${site}/api/research/config`, { redirect: 'manual', signal: AbortSignal.timeout(15000) }))
  const authURL = new URL(config.supabase_url)
  if (authURL.username || authURL.password || authURL.pathname !== '/' || authURL.search || authURL.hash || (authURL.protocol !== 'https:' && !(authURL.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(authURL.hostname))) || typeof config.publishable_key !== 'string') throw Error('公開Auth設定が不正です。')
  const storage = new Map()
  const client = createClient(config.supabase_url, config.publishable_key, { auth: {
    flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  } })
  let finish, fail
  const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  // The callback/deadline can reject while OAuth setup is still awaiting I/O.
  completed.catch(() => {})
  const server = createServer(async (request, response) => {
    let u
    try { u = new URL(request.url ?? '/', 'http://localhost:4318') } catch { response.writeHead(400); response.end(); return }
    if (request.method !== 'GET' || u.pathname !== '/callback' || request.headers.host !== 'localhost:4318') { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'")
    try {
      const code = u.searchParams.get('code')
      if (!code) throw Error('OAuth callbackにコードがありません。')
      const { data, error } = await client.auth.exchangeCodeForSession(code)
      if (error || !data.session) throw Error('PKCE認証に失敗しました。callbackの許可設定を確認してください。')
      const credentials = { site, supabase_url: config.supabase_url, publishable_key: config.publishable_key, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at } }
      await authorized(credentials, site)
      await saveAuth(authFile, credentials)
      response.end('<!doctype html><meta charset="utf-8"><title>CLI認証完了</title><p>本人のGoogle認証を確認しました。このタブを閉じてTerminalに戻ってください。</p>')
      finish()
    } catch (e) {
      response.writeHead(403)
      response.end('<!doctype html><meta charset="utf-8"><title>CLI認証失敗</title><p>本人認証を確認できませんでした。Terminalの案内を確認してください。</p>')
      fail(e)
    }
  })
  server.listen(4318, '127.0.0.1')
  await once(server, 'listening')
  const timer = setTimeout(() => fail(Error('Google認証の待機が時間切れになりました。認証情報は保存していません。')), timeoutMs)
  try {
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'http://localhost:4318/callback', queryParams: { prompt: 'select_account' } } })
    if (error || !data.url) throw Error('Googleログインを開始できません。')
    log(`Googleログインを開きます。ブラウザーが開かない場合はこのURLを開いてください:\n${data.url}`)
    if (openBrowser) {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open'
      if (command) { const browser = spawn(command, [data.url], { stdio: 'ignore', shell: false }); browser.on('error', () => {}); browser.unref() }
    }
    await completed
    log('CLIの本人認証を保存しました。トークンは表示しません。')
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

export async function publishArtifact({ input, site, parentId = null, authFile = defaultAuthFile, fetchImpl = fetch }) {
  site = siteOrigin(site)
  const bytes = await readFile(input)
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw Error('登録するJSONは240KB以内にしてください。')
  const artifact = normalizeArtifact(JSON.parse(bytes.toString('utf8')))
  if (parentId && (!validDocumentId(parentId) || artifact.kind !== 'investigation')) throw Error('--parent は調査結果に関連付ける物語のUUIDを指定してください。')
  const credentials = await privateFile(authFile)
  if (credentials.site !== site) throw Error('認証ファイルと登録先が違います。そのサイト用のloginを実行してください。')
  if (!credentials.session?.access_token || !credentials.session.refresh_token) throw Error('認証ファイルが不正です。loginを実行してください。')
  if (!Number.isFinite(credentials.session.expires_at)) throw Error('認証の有効期限が不明です。loginを実行してください。')
  if (credentials.session.expires_at <= Date.now() / 1000 + 60) {
    const client = createClient(credentials.supabase_url, credentials.publishable_key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data, error } = await client.auth.refreshSession({ refresh_token: credentials.session.refresh_token })
    if (error || !data.session) throw Error('Googleセッションを更新できません。loginを実行してください。API課金や別アカウントへ切り替えません。')
    credentials.session = { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at }
    await saveAuth(authFile, credentials)
  }
  const body = JSON.stringify({ packet: artifact.packet, parent_id: parentId })
  if (Buffer.byteLength(body) > MAX_ARTIFACT_BYTES) throw Error('登録要求が大きすぎます。')
  const result = await jsonResponse(await fetchImpl(`${site}/api/research/documents`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.session.access_token}` }, body,
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  }))
  if (!validDocumentId(result.id) || result.path !== `/research/${result.id}`) throw Error('登録結果のURLが不正です。')
  return { id: result.id, url: `${site}${result.path}`, duplicate: result.duplicate === true }
}

export function parsePublishArgs(args) {
  const options = { mode: args[0] }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (['--site', '--input', '--parent', '--auth-file'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw Error(`${arg} の値が必要です。`)
      options[arg.slice(2)] = value
    } else throw Error(`不明なオプション: ${arg}`)
  }
  if (!['login', 'publish'].includes(options.mode) || !options.site || (options.mode === 'publish' && !options.input)) throw Error('npm run publish -- login --site https://research.example.com または publish --site ... --input story-1.json [--parent UUID]')
  return options
}
async function cli() {
  const options = parsePublishArgs(process.argv.slice(2))
  const common = { site: options.site, authFile: options['auth-file'] ? resolve(options['auth-file']) : defaultAuthFile }
  if (options.mode === 'login') return loginPublisher(common)
  const result = await publishArtifact({ ...common, input: resolve(options.input), parentId: options.parent ?? null })
  console.log(JSON.stringify(result))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => {
  // SDK/network error objects can contain credentials. Emit only our fixed messages.
  console.error(error.code === 'ENOENT' ? '入力または認証ファイルがありません。JSONのパスとloginを確認してください。' : '登録または認証に失敗しました。JSON・登録先・本人認証・SQL・callback設定を確認してください。自動再試行はしません。')
  process.exitCode = 1
})
