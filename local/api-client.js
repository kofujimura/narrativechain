import { readFile, open, unlink, access, mkdir } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { join } from 'node:path'
import { reserve, settle, saveJSON, readJSON, hash, committed } from './budget.js'
import { parseResponseJSON } from '../agents/impactPolicy.js'
import { DEFAULT_MODEL } from '../agents/modelConfig.js'

export async function setting(root, name) {
  if (process.env[name]) return process.env[name]
  for (const file of ['research/.env.local', '.env.local', '.env']) {
    try { const env = parseEnv(await readFile(join(root, file), 'utf8')); if (env[name]) return env[name] } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  return null
}
export const apiKey = root => setting(root, 'OPENAI_API_KEY')
export async function generationBackend(root, override) {
  const backend = override ?? await setting(root, 'NARRATIVE_LLM_BACKEND') ?? 'codex'
  if (!['codex', 'api'].includes(backend)) throw Error('実行方式は codex または api を指定してください。')
  return backend
}
export async function codexModelSettings(root) {
  const model = await setting(root, 'NARRATIVE_MODEL') || DEFAULT_MODEL
  return { filter: await setting(root, 'NARRATIVE_FILTER_MODEL') || model, generation: model }
}
export async function modelSettings(root) {
  return { filter: await setting(root, 'OPENAI_FILTER_MODEL') || DEFAULT_MODEL, generation: await setting(root, 'OPENAI_MODEL') || DEFAULT_MODEL }
}
export async function budgetDirectory(root) {
  const legacy = join(root, 'research/data/llm-budget')
  try { await access(legacy); return { dir: legacy, legacy: true } } catch (e) { if (e.code !== 'ENOENT') throw e }
  return { dir: join(root, 'local/data/llm-budget'), legacy: false }
}
const emptyLedger = () => ({ cap_jpy: 1600, calls: [] })
export async function budgetStatus(root) {
  const budget = await budgetDirectory(root)
  const ledger = await readJSON(join(budget.dir, 'ledger.json'), budget.legacy ? undefined : emptyLedger())
  return { cap: ledger.cap_jpy, used: committed(ledger), remaining: ledger.cap_jpy - committed(ledger) }
}
export async function paidJSON(root, jobDir, id, request, { signal, log = () => {} } = {}) {
  const key = await apiKey(root)
  if (!key) throw Error('OPENAI_API_KEYが未設定です。.env.localに設定してください。')
  const budget = await budgetDirectory(root), budgetDir = budget.dir, lockPath = join(budgetDir, 'runner.lock')
  await mkdir(budgetDir, { recursive: true, mode: 0o700 })
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw Error('予算台帳を別プロセスが使用中です。自動再試行はしません。') })
  try {
    const ledgerPath = join(budgetDir, 'ledger.json'), ledger = await readJSON(ledgerPath, budget.legacy ? undefined : emptyLedger())
    if (budget.legacy) {
      const config = await readJSON(join(root, 'research/config/experiment-budget.json'))
      if (!config.llm_execution_enabled || ledger.cap_jpy !== config.initial_llm_experiment_cap) throw Error('予算設定を確認してください。')
    }
    if (ledger.cap_jpy !== 1600) throw Error('予算設定を確認してください。')
    if (request.model === 'gpt-5.6-sol' && new Date().toISOString().slice(0, 10) > '2026-11-21') throw Error('Solの価格表を公式資料で再確認してください（確認期限2026-11-21）。')
    const row = reserve(ledger, `local/${id}`, request), path = join(jobDir, `${id.split('/').at(-1)}-response.json`)
    if (row.status === 'complete') { const result = await readJSON(path); if (hash(result) !== row.response_hash) throw Error('保存結果の不一致'); return result.result }
    const requestCap = ['gpt-5.6-sol', 'gpt-6.1-sol'].includes(request.model) ? 100 : 50
    if (row.reserved_jpy > requestCap) throw Error(`1リクエストの上限${requestCap}円相当を超えます。入力を減らしてください。`)
    await saveJSON(ledgerPath, ledger)
    log(`OpenAI API開始（最大予約 ${row.reserved_jpy.toFixed(2)}円相当）`)
    try {
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      if (!response.ok) throw Error(`HTTP_${response.status}`)
      const raw = await response.json()
      if (JSON.stringify(raw).includes(key)) throw Error('安全検査に失敗')
      if (raw.usage) settle(row, raw.usage)
      await saveJSON(path, { raw, result: null })
      if (!raw.usage) throw Error('利用量不明')
      const artifact = { raw, result: parseResponseJSON(raw) }
      await saveJSON(path, artifact)
      row.status = 'complete'; row.response_hash = hash(artifact); row.finished_at = new Date().toISOString()
      await saveJSON(ledgerPath, ledger); log(`API完了（${row.charged_jpy.toFixed(2)}円相当）`)
      return artifact.result
    } catch (e) {
      if (row.status !== 'bound_exceeded') row.status = 'failed_or_uncertain'
      row.error_code = /^HTTP_\d+$/.test(e.message) ? e.message : 'REQUEST_FAILED'
      await saveJSON(ledgerPath, ledger)
      throw Error(`API処理を停止: ${row.error_code}。予約/使用額を維持し、自動再試行しません。`)
    }
  } finally { await lock.close(); await unlink(lockPath) }
}
