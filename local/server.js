import http from 'node:http'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { generateStories } from './generate.js'
import { apiKey, budgetStatus, generationBackend } from './api-client.js'
import { codexLoginStatus } from './codex-client.js'
import { readJSON, saveJSON } from './budget.js'
import { renderReport } from './report.js'
import { renderStoriesHTML } from './story-html.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
async function body(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw Error('JSON形式が必要です。')
  const buffers = []; let bytes = 0
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 1800000) throw Error('入力は合計1.8MB以内にしてください。'); buffers.push(chunk) }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'))
}
export async function createLocalServer({ dataDir = join(root, 'local/data'), generate = generateStories, codexStatus = codexLoginStatus } = {}) {
  const jobsDir = join(dataDir, 'jobs'); await mkdir(jobsDir, { recursive: true, mode: 0o700 })
  const token = randomBytes(32).toString('hex'), jobs = new Map(), active = new Map(), samples = []
  try {
    // Optional legacy samples: the app also starts without the ignored research directory.
    const { cases } = await import('../research/narrative-pilot-fixtures.js')
    const report = await readJSON(join(root, 'research/data/impact-samples/v1/report.json'))
    for (const g of report.generated) {
      const c = cases.find(c => c.id === g.article.id)
      samples.push({ ...g.result, id: c.id, title: c.title, facts: c.facts.map((f, i) => ({ id: `F${i + 1}`, text: f.slice(f.indexOf(':') + 1).trim(), title: c.title, url: c.url })),
        review: report.safety.results.find(r => r.id === c.id)?.findings.join('\n') || '前回実験でのAI点検済み。ただし事実認定ではありません。' })
    }
  } catch { /* Samples are optional on a fresh checkout. */ }
  for (const name of await readdir(jobsDir)) {
    if (!/^[a-f0-9-]{36}$/.test(name)) continue
    try { const j = await readJSON(join(jobsDir, name, 'job.json')); if (j.id !== name) continue; if (j.status === 'running') { j.status = 'interrupted'; j.error = 'サーバー再起動により中断。自動再試行しません。'; await saveJSON(join(jobsDir, name, 'job.json'), j) } jobs.set(name, j) } catch {}
  }
  const getStory = (source, id) => (source === 'samples' ? samples : jobs.get(source)?.result?.stories ?? []).find(s => s.id === id)
  async function startJob(type, task) {
    if (active.size) throw Error('現在の処理が完了または中止されるまでお待ちください。')
    const id = randomUUID(), dir = join(jobsDir, id), controller = new AbortController()
    active.set(id, controller)
    try { await mkdir(dir, { mode: 0o700 }) } catch (e) { active.delete(id); throw e }
    const job = { id, type, status: 'running', created_at: new Date().toISOString(), logs: [], result: null, error: null }
    jobs.set(id, job)
    let writes = Promise.resolve()
    const persist = () => { const snapshot = JSON.parse(JSON.stringify(job)); writes = writes.then(() => saveJSON(join(dir, 'job.json'), snapshot)); return writes }
    const log = text => { job.logs.push({ at: new Date().toISOString(), text: String(text).slice(0, 3000) }); if (job.logs.length > 400) job.logs.shift(); console.log(`[${id.slice(0, 8)}] ${String(text).slice(0, 250)}`); persist() }
    await persist()
    const timer = setTimeout(() => controller.abort(), 600000)
    Promise.resolve().then(() => task({ id, dir, signal: controller.signal, log, root })).then(result => { job.result = result; job.status = controller.signal.aborted ? 'cancelled' : 'complete' })
      .catch(error => { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; log(error.message) })
      .finally(async () => { clearTimeout(timer); active.delete(id); await persist().catch(console.error) })
    return job
  }
  const server = http.createServer(async (req, res) => {
    const port = server.address().port, allowed = [`127.0.0.1:${port}`, `localhost:${port}`], host = req.headers.host
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'")
    if (!allowed.includes(host)) return json(res, 403, { error: 'Hostを拒否しました。localhost専用です。' })
    if (req.method !== 'GET') {
      const supplied = Buffer.from(String(req.headers['x-narrative-token'] ?? '')), expected = Buffer.from(token)
      if (req.headers.origin !== `http://${host}` || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 403, { error: '同一画面からの操作のみ受け付けます。' })
    }
    try {
      const u = new URL(req.url, `http://${host}`)
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(u.pathname)) {
        const name = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), content = await readFile(join(root, 'local/public', name))
        res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(content); return
      }
      if (req.method === 'GET' && u.pathname === '/api/bootstrap') return json(res, 200, { token, default_backend: await generationBackend(root), codex: await codexStatus(), api_configured: Boolean(await apiKey(root)), budget: await budgetStatus(root).catch(() => null), samples, jobs: [...jobs.values()].reverse() })
      if (req.method === 'GET' && u.pathname === '/api/packet') {
        const story = getStory(u.searchParams.get('job'), u.searchParams.get('story'))
        if (!story) return json(res, 404, { error: '物語が見つかりません。' })
        res.setHeader('Content-Disposition', 'attachment; filename="narrative-investigation.json"')
        return json(res, 200, { schema_version: 'narrative-investigation/v1', exported_at: new Date().toISOString(), story })
      }
      const match = u.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/(?:report|stories|story-\d+\.json))?$/)
      if (req.method === 'GET' && match) {
        const job = jobs.get(match[1]); if (!job) return json(res, 404, { error: 'ジョブが見つかりません。' })
        if (!match[2]) return json(res, 200, job)
        if (/\/story-\d+\.json$/.test(match[2])) {
          const story = getStory(job.id, match[2].slice(1, -5))
          if (!story) return json(res, 404, { error: '物語が見つかりません。' })
          return json(res, 200, { schema_version: 'narrative-investigation/v1', story })
        }
        if (match[2] === '/stories') {
          if (!job.result?.stories) return json(res, 409, { error: '物語はまだありません。' })
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderStoriesHTML(job.result)); return
        }
        if (!job.result?.report) return json(res, 409, { error: 'レポートはまだありません。' })
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderReport(job.result.report, { demo: job.result.demo })); return
      }
      if (req.method === 'POST' && u.pathname === '/api/generate') {
        const input = await body(req)
        if (input.consent !== true || !Array.isArray(input.inputs) || input.inputs.length < 1 || input.inputs.length > 6) return json(res, 400, { error: '送信許可の確認と1〜6件の入力が必要です。' })
        const backend = await generationBackend(root, input.backend)
        if (backend === 'api') {
          if (input.ackApiCost !== true) return json(res, 400, { error: 'API従量課金の明示的な同意が必要です。' })
          if (!await apiKey(root)) return json(res, 409, { error: 'APIモードにはOPENAI_API_KEYが必要です。サブスク版はCodexのChatGPTログインを使用します。' })
        } else {
          const status = await codexStatus()
          if (!status.ready) return json(res, 409, { error: status.message })
        }
        const job = await startJob('generation', options => generate({ ...options, backend, inputs: input.inputs, combine: input.combine === true }))
        return json(res, 202, job)
      }
      if (req.method === 'POST' && u.pathname === '/api/investigate') {
        const input = await body(req), story = getStory(input.sourceJobId, input.storyId)
        if (!story || story.decision !== 'story') return json(res, 400, { error: '調査対象の物語がありません。' })
        if (!input.demo && input.ackUsage !== true) return json(res, 400, { error: 'Codex利用枠の消費に同意してください。' })
        const demo = input.demo === true
        const job = await startJob(demo ? 'research-demo' : 'research', async ({ dir, signal, log }) => {
          const packetPath = join(dir, 'packet.json'), outputDir = join(dir, 'investigation')
          await saveJSON(packetPath, { schema_version: 'narrative-investigation/v1', story })
          const args = [join(root, 'local/research-cli.js'), '--input', packetPath, '--output', outputDir, demo ? '--demo' : '--ack-usage']
          log(`Terminalプロセス: node local/research-cli.js --input packet.json --output investigation ${demo ? '--demo' : '--ack-usage'}`)
          const child = spawn(process.execPath, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
          let buffer = '', error = '', bytes = 0
          child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 2000000) { child.kill('SIGTERM'); return }; buffer += chunk.toString(); let n; while ((n = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, n); buffer = buffer.slice(n + 1); try { log(JSON.parse(line).text) } catch {} } })
          child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-1000) })
          const abort = () => child.kill('SIGTERM'); signal.addEventListener('abort', abort, { once: true })
          try {
            const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
            if (code !== 0 || signal.aborted) throw Error(error.trim() || '調査が中止または失敗しました。')
            return { report: await readJSON(join(outputDir, 'report.json')), demo }
          } finally { signal.removeEventListener('abort', abort) }
        })
        return json(res, 202, job)
      }
      if (req.method === 'POST' && u.pathname === '/api/cancel') {
        const { id } = await body(req); active.get(id)?.abort(); return json(res, 200, { cancelled: active.has(id) })
      }
      return json(res, 404, { error: '見つかりません。' })
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end() }
  })
  return { server, close: async () => { for (const controller of active.values()) controller.abort(); await new Promise(resolve => server.close(resolve)) } }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = await createLocalServer(), port = Number(process.env.NARRATIVE_PORT || 4317)
  app.server.listen(port, '127.0.0.1', () => console.log(`NarrativeChain Local → http://localhost:${port}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)))
}
