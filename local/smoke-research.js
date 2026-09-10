// Explicit live, read-only research smoke test; consumes Codex/ChatGPT usage.
const base = 'http://127.0.0.1:4317'
const bootstrap = await (await fetch(base + '/api/bootstrap')).json()
const response = await fetch(base + '/api/investigate', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Narrative-Token': bootstrap.token },
  body: JSON.stringify({ sourceJobId: 'samples', storyId: 'wind-aip', ackUsage: true }) })
let job = await response.json()
if (!response.ok) throw Error(job.error)
console.log(`Live research job: ${job.id}`)
let logs = 0
for (let n = 0; n < 340; n++) {
  job = await (await fetch(base + '/api/jobs/' + job.id)).json()
  for (const line of job.logs.slice(logs)) console.log(line.text)
  logs = job.logs.length
  if (job.status !== 'running') {
    console.log(JSON.stringify({ status: job.status, id: job.id, candidates: job.result?.report?.candidates?.map(c => c.company), error: job.error }))
    if (job.status !== 'complete') process.exitCode = 1
    break
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
