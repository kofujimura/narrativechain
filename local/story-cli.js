#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateStories, prepareGeneration, planGeneration, finishGeneration } from './generate.js'
import { generationBackend } from './api-client.js'
import { readJSON } from './budget.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function parseStoryArgs(args) {
  const options = { inputs: [], combine: false, ackUsage: false, ackApiCost: false, mode: 'run' }
  let modes = 0
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (['--input', '--url', '--output', '--backend'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw Error(`${arg} の値が必要です。`)
      if (arg === '--input' || arg === '--url') options.inputs.push({ type: arg === '--url' ? 'url' : 'file', value })
      else options[arg.slice(2)] = value
    } else if (arg === '--combine') options.combine = true
    else if (arg === '--ack-usage') options.ackUsage = true
    else if (arg === '--ack-api-cost') options.ackApiCost = true
    else if (['--prepare', '--plan', '--render'].includes(arg)) { options.mode = arg.slice(2); modes++ }
    else if (arg === '--help') options.help = true
    else throw Error(`不明なオプション: ${arg}`)
  }
  if (modes > 1) throw Error('prepare / plan / render は1工程ずつ実行してください。')
  if (!options.help && !options.output) throw Error('--output で新しい出力ディレクトリを指定してください。')
  return options
}
async function loadInputs(inputs) {
  const result = []
  for (const input of inputs) {
    if (input.type === 'url') { result.push({ type: 'url', content: input.value }); continue }
    const path = resolve(input.value), extension = extname(path).toLowerCase()
    if (!['.txt', '.md', '.html', '.htm', '.json'].includes(extension)) throw Error('対応形式は txt / md / html / json です。')
    const content = await readFile(path, 'utf8')
    if (Buffer.byteLength(content) > 300000) throw Error('ファイルは300KB以内にしてください。')
    result.push({ type: ['.html', '.htm'].includes(extension) ? 'html' : extension === '.json' ? 'json' : 'text', name: path.split('/').at(-1), content })
  }
  return result
}
export async function runStoryCLI(args, { signal, log = console.log } = {}) {
  const options = parseStoryArgs(args)
  if (options.help) { log('node local/story-cli.js --input news.html [--input news.txt | --url https://…] --output new-directory --ack-usage [--combine]\nSkill内の直接実行: --prepare → filter-result.jsonを作成 → --plan → story-N-result.jsonを作成 → --render\nAPI明示指定: --backend api --ack-api-cost'); return }
  const dir = resolve(options.output)
  if (['plan', 'render'].includes(options.mode)) {
    if (options.inputs.length || options.backend || options.combine) throw Error('plan / render は既存の準備結果を使用します。入力や実行方式を変更できません。')
    if (options.mode === 'plan') {
      const plan = await planGeneration({ dir, raw: await readJSON(join(dir, 'filter-result.json')), log })
      log(plan.length ? `生成対象: ${plan.map(p => `${p.id}-request.json`).join(', ')}` : '該当なし。物語は作らず --render で終了してください。')
      return plan
    }
    const result = await finishGeneration({ dir }); log(`HTML: ${join(dir, 'stories.html')}`); return result
  }
  if (!options.inputs.length || options.inputs.length > 6) throw Error('ニュースを1〜6件入力してください。')
  // Skill preparation is deterministic and uses the current agent, never a child/API.
  const backend = options.mode === 'prepare' ? 'codex' : await generationBackend(root, options.backend)
  if (options.mode === 'prepare' && options.backend && options.backend !== 'codex') throw Error('SkillのprepareモードはAPIを呼びません。')
  if (options.mode === 'run' && backend === 'codex' && !options.ackUsage) throw Error('ChatGPT/Codex利用枠を消費します。--ack-usage が必要です。')
  if (options.mode === 'run' && backend === 'api' && !options.ackApiCost) throw Error('API従量課金です。--backend api --ack-api-cost が必要です。')
  const inputs = await loadInputs(options.inputs)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, 'started.json'), JSON.stringify({ backend, mode: options.mode, started_at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 })
  if (options.mode === 'prepare') {
    await prepareGeneration({ root, dir, inputs, combine: options.combine, backend, signal, log })
    log(`AIを呼ばずに準備しました。${join(dir, 'filter-request.json')} の規則・入力・スキーマに従って filter-result.json を作成してください。`)
    return
  }
  const result = await generateStories({ root, dir, id: 'cli', inputs, combine: options.combine, backend, signal, log })
  log(`HTML: ${join(dir, 'stories.html')}`)
  return result
}
async function cli() {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort())
  await runStoryCLI(process.argv.slice(2), { signal: controller.signal })
}
if (process.argv[1] && (fileURLToPath(import.meta.url) === resolve(process.argv[1]) || process.argv[1].endsWith('/generate.mjs'))) cli().catch(e => { console.error(e.code === 'EEXIST' ? 'この出力先は使用済みです。新しいディレクトリを指定してください。自動再試行しません。' : e.message); process.exitCode = 1 })
