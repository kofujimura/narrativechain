const $ = id => document.getElementById(id)
let token = '', sourceJobId = 'samples', pendingStory = null, activeJobId = null, sampleStories = [], knownJobs = [], pollTimer
function element(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el }
function error(message) { $('error').textContent = message; $('error').hidden = !message }
async function request(path, value) {
  const response = await fetch(path, value ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Narrative-Token': token }, body: JSON.stringify(value) } : {})
  const result = await response.json(); if (!response.ok) throw Error(result.error || '処理に失敗しました'); return result
}
function renderStories(stories, source) {
  sourceJobId = source; $('stories').replaceChildren(); $('story-count').textContent = `${stories.length} STORIES`
  for (const [i, story] of stories.entries()) {
    const card = element('article', null, 'card')
    card.append(element('div', `${source === 'samples' ? 'SAVED EXPERIMENT' : 'GENERATED NARRATIVE'} / ${String(i + 1).padStart(2, '0')}`, 'meta'), element('h3', story.title), element('p', story.narrative, 'narrative'))
    const chain = element('div', null, 'chain'); for (const [j, c] of story.chain.entries()) chain.append(element('span', `${j + 1}. ${c.event}`)); card.append(chain)
    if (story.review) card.append(element('p', story.review, 'warning'))
    const details = element('details'); details.append(element('summary', '成立条件・反証・次の質問'))
    for (const c of story.chain) { details.append(element('p', `条件: ${c.condition ?? ''}`), element('p', `反証: ${c.refutation ?? ''}`)) }
    const list = element('ul'); for (const q of story.questions ?? []) list.append(element('li', q)); details.append(list); card.append(details)
    const actions = element('div', null, 'card-actions'), button = element('button', '調査する ↗', 'primary')
    button.disabled = story.decision !== 'story'; button.addEventListener('click', () => { pendingStory = { storyId: story.id, sourceJobId: source }; $('dialog-title').textContent = 'この物語を調査しますか？'; $('research-dialog').showModal() })
    const link = element('a', 'JSONを保存', 'json-link'); link.href = `/api/packet?job=${encodeURIComponent(source)}&story=${encodeURIComponent(story.id)}`
    actions.append(button, link); card.append(actions); $('stories').append(card)
  }
  if (!stories.length) $('stories').append(element('p', '生成された物語はありません。新たな変化のあるニュースをお試しください。', 'muted'))
}
function history() {
  $('history').replaceChildren(element('option', '履歴を選択'))
  $('history').firstChild.value = ''
  for (const job of knownJobs) { const option = element('option', `${new Date(job.created_at).toLocaleString('ja-JP')} · ${job.type} · ${job.status}`); option.value = job.id; $('history').append(option) }
}
async function bootstrap() {
  const state = await request('/api/bootstrap'); token = state.token; sampleStories = state.samples; knownJobs = state.jobs
  $('connection').textContent = state.api_configured ? '● LOCAL CONNECTED' : '○ APIキー未設定'
  $('budget').textContent = state.budget ? `API予算: 残り ${Math.floor(state.budget.remaining).toLocaleString()}円相当 / 累計上限 ${state.budget.cap.toLocaleString()}円相当。Codex利用枠は別。` : 'API予算台帳がありません。実験設定を確認してください。'
  history(); return state
}
function renderJob(job) {
  error(job.error || '')
  $('logs').textContent = job.logs.map(l => `${new Date(l.at).toLocaleTimeString('ja-JP')}  ${l.text}`).join('\n') || '処理を開始しています…'
  $('logs').scrollTop = $('logs').scrollHeight
  $('cancel').hidden = job.status !== 'running'; $('generate').disabled = job.status === 'running'
  if (job.error) error(job.error)
  if (job.result?.stories) {
    renderStories(job.result.stories, job.id); $('story-note').textContent = job.result.note
    const details = element('details'); details.append(element('summary', 'ニュースの選別結果'))
    for (const a of job.result.assessments) details.append(element('p', `${a.decision} · ${a.article?.title ?? ''} — ${a.reason}`))
    $('filter-results').replaceChildren(details)
  }
  if (job.result?.report) { $('report-empty').hidden = true; $('report').hidden = false; $('report').src = `/api/jobs/${job.id}/report` }
  else {
    $('report').hidden = true; $('report').removeAttribute('src'); $('report-empty').hidden = false
    $('report-empty').textContent = job.type === 'generation' ? '物語の「調査する」を選ぶと、その物語の調査結果を表示します。' : job.status === 'running' ? '調査中です。完了するとレポートを表示します。' : 'この処理には完成した調査レポートがありません。'
  }
}
async function watch(id) {
  clearTimeout(pollTimer); activeJobId = id
  try {
    const job = await request(`/api/jobs/${id}`); renderJob(job)
    if (job.status === 'running') pollTimer = setTimeout(() => watch(id), 1200)
    else { activeJobId = null; await bootstrap() }
  } catch (e) { error(e.message); $('generate').disabled = false }
}
$('generate').addEventListener('click', async () => {
  error(''); $('generate').disabled = true
  try {
    const inputs = $('urls').value.split('\n').map(x => x.trim()).filter(Boolean).map(content => ({ type: 'url', content }))
    const content = $('content').value.trim()
    if (content) inputs.push({ type: /<\w+[\s>]/.test(content) ? 'html' : 'text', content })
    for (const file of $('files').files) {
      if (file.size > 300000) throw Error('1ファイル300KB以内で入力してください。')
      if (!/\.(txt|md|html?|json)$/i.test(file.name)) throw Error('対応形式: txt / md / html / json')
      inputs.push({ type: /\.html?$/i.test(file.name) ? 'html' : /\.json$/i.test(file.name) ? 'json' : 'text', name: file.name, content: await file.text() })
    }
    const job = await request('/api/generate', { inputs, combine: $('combine').checked, consent: $('consent').checked }); $('story-note').textContent = '入力を選別し、通過したニュースだけで生成しています。'; await watch(job.id)
  } catch (e) { error(e.message); $('generate').disabled = false }
})
$('files').addEventListener('change', () => { $('file-names').textContent = [...$('files').files].map(f => f.name).join(' / ') })
$('samples').addEventListener('click', () => { renderStories(sampleStories, 'samples'); $('filter-results').replaceChildren(); $('story-note').textContent = '前回の実験で生成した実際のサンプルです。表示による追加費用はありません。' })
$('dialog-close').addEventListener('click', () => $('research-dialog').close())
async function investigate(demo) {
  if (!pendingStory) return
  $('research-dialog').close(); error('')
  try { const job = await request('/api/investigate', { ...pendingStory, demo, ackUsage: !demo }); $('report').hidden = true; $('report-empty').hidden = false; $('report-empty').textContent = demo ? 'デモ接続テスト中（架空データ）…' : 'Codex CLIで調査中…'; document.querySelector('.research').scrollIntoView({ behavior: 'smooth' }); await watch(job.id) } catch (e) { error(e.message) }
}
$('investigate').addEventListener('click', () => investigate(false)); $('demo').addEventListener('click', () => investigate(true))
$('cancel').addEventListener('click', async () => { if (activeJobId) { try { await request('/api/cancel', { id: activeJobId }) } catch (e) { error(e.message) } } })
$('history').addEventListener('change', () => { if ($('history').value) watch($('history').value) })
bootstrap().then(state => { renderStories(sampleStories, 'samples'); $('story-note').textContent = '前回の実験で生成した実際のサンプルです。まずは気になる物語を選んでみてください。'; const running = state.jobs.find(j => j.status === 'running'); if (running) watch(running.id) }).catch(e => error(e.message))
