import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const MAX_TEXT = 24000, MAX_DOWNLOAD = 1024 * 1024
export function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false
  const [a, b] = ip.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0))
}
export function checkURL(value) {
  const u = new URL(value)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local')) throw Error('公開HTTP(S) URLのみ利用できます。ポート・認証情報・ローカルURLは不可です。')
  if (isIP(u.hostname) && !publicIPv4(u.hostname)) throw Error('ローカル/予約アドレスは取得できません。')
  return u
}
export async function downloadNews(value, redirects = 0, signal) {
  const u = checkURL(value)
  if (redirects > 4) throw Error('リダイレクトが多すぎます。')
  const addresses = await lookup(u.hostname, { family: 4, all: true })
  if (!addresses.length || addresses.some(x => !publicIPv4(x.address))) throw Error('公開IPv4アドレス以外への接続は拒否しました。')
  // Pin the validated address; do not perform a second DNS lookup during connection.
  const result = await new Promise((resolve, reject) => {
    const request = (u.protocol === 'https:' ? https : http).get(u, { agent: false, signal,
      lookup: (_host, options, cb) => options.all ? cb(null, [{ address: addresses[0].address, family: 4 }]) : cb(null, addresses[0].address, 4),
      headers: { 'User-Agent': 'NarrativeChain-Local/1.0 (user-requested news reading)', Accept: 'text/html,text/plain,application/xhtml+xml', 'Accept-Encoding': 'identity' },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume(); resolve({ redirect: new URL(response.headers.location, u).href }); return
      }
      if (response.statusCode !== 200) { response.resume(); reject(Error(`URL取得に失敗 (HTTP ${response.statusCode})。アクセス制限の回避は行いません。`)); return }
      if (!/^(text\/(html|plain)|application\/xhtml\+xml)/i.test(response.headers['content-type'] ?? '')) { response.resume(); reject(Error('HTML/テキスト以外は現在未対応です。')); return }
      const chunks = []; let size = 0
      response.on('data', b => { size += b.length; if (size > MAX_DOWNLOAD) response.destroy(Error('本文が1MBを超えています。')); else chunks.push(b) })
      response.on('error', reject)
      response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: u.href, html: !String(response.headers['content-type']).startsWith('text/plain') }))
    })
    request.setTimeout(15000, () => request.destroy(Error('URL取得がタイムアウトしました。')))
    request.on('error', reject)
  })
  return result.redirect ? downloadNews(result.redirect, redirects + 1, signal) : result
}
function decode(s) {
  return s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, x) => { const n = x[0].toLowerCase() === 'x' ? parseInt(x.slice(1), 16) : Number(x); return n <= 0x10ffff && n > 0 ? String.fromCodePoint(n) : '' })
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
}
// Text extraction, not HTML rendering. Scripts/resources are never executed.
export function htmlToNews(html, fallback = '入力ニュース') {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const title = decode((clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? fallback).replace(/<[^>]*>/g, '')).trim().slice(0, 200)
  const main = clean.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? clean
  return { title, body: decode(main.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) }
}
export async function normalizeInputs(inputs, { signal, fetcher = downloadNews } = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 6) throw Error('ニュースは1〜6件で入力してください。')
  const articles = []
  for (const input of inputs) {
    if (!input || !['url', 'html', 'text', 'json'].includes(input.type) || typeof input.content !== 'string' || input.content.length > 300000) throw Error('入力形式またはサイズが不正です。')
    let article, url = ''
    if (input.type === 'url') { const fetched = await fetcher(input.content.trim(), 0, signal); url = fetched.url; article = fetched.html ? htmlToNews(fetched.text) : { title: url, body: fetched.text } }
    else if (input.type === 'html') article = htmlToNews(input.content, String(input.name || 'HTMLニュース'))
    else if (input.type === 'json') {
      const data = JSON.parse(input.content)
      article = { title: String(data.title || input.name || 'JSONニュース'), body: typeof data.body === 'string' ? data.body : Array.isArray(data.facts) ? data.facts.join('\n') : '' }
      if (data.url) url = checkURL(data.url).href
    } else article = { title: String(input.name || input.content.split('\n')[0]).slice(0, 200), body: input.content }
    // PostgreSQL jsonb rejects escaped NUL (22P05); discard it before evidence is packaged.
    article.body = article.body.replace(/\u0000/g, '').trim().slice(0, MAX_TEXT)
    if (article.body.length < 30) throw Error('本文が短すぎます。本文を取得できないURLはHTML/テキストで入力してください。')
    articles.push({ ...article, id: `news-${articles.length + 1}`, url, source: url ? new URL(url).hostname : 'ユーザー入力',
      original_characters: input.content.length, retrieved_at: new Date().toISOString(), title: article.title.replace(/\u0000/g, '').slice(0, 200) })
  }
  return articles
}
