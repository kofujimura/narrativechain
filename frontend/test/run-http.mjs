import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, rm, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { httpTestEnvironment } from './http-env.mjs'

const root = new URL('../', import.meta.url)
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  throw new Error('HTTP tests require Node.js 22.13 or later. Switch Node versions and rerun npm run test:http.')
}
const run = randomUUID()
const output = new URL(`.next-http-tests/${run}/`, root)
const env = httpTestEnvironment(run)
let active
let stopping = false
function stop(signal) {
  stopping = true
  active?.kill(signal)
}
const onTerm = () => stop('SIGTERM')
const onInt = () => stop('SIGINT')
process.on('SIGTERM', onTerm)
process.on('SIGINT', onInt)

async function command(args) {
  active = spawn(process.execPath, args, { cwd: output, env, stdio: 'inherit' })
  return new Promise((resolve, reject) => {
    active.once('error', reject)
    active.once('exit', code => resolve(code ?? 1))
  })
}

try {
  console.log('HTTP tests: isolated source-only copy and mock build; no .env files or dev server changes.')
  await mkdir(output, { recursive: true })
  // Explicit source inventory. Never copy .env*, .next, research data, credentials
  // or user-generated files. Next may rewrite TS/generated files in this copy only.
  for (const name of ['app', 'lib', 'public', 'proxy.ts', 'next.config.ts', 'tsconfig.json', 'package.json', 'postcss.config.mjs']) {
    await cp(new URL(name, root), new URL(name, output), { recursive: true })
  }
  await symlink(fileURLToPath(new URL('node_modules', root)), fileURLToPath(new URL('node_modules', output)), 'dir')
  const buildCode = await command(['node_modules/next/dist/bin/next', 'build'])
  process.exitCode = buildCode
  if (buildCode === 0 && !stopping) process.exitCode = await command(['--test', fileURLToPath(new URL('test/http.test.mjs', root))])
} finally {
  process.off('SIGTERM', onTerm)
  process.off('SIGINT', onInt)
  // Only this run's generated UUID directory, never .next, a glob, or user data.
  const exactOutput = fileURLToPath(output)
  await rm(exactOutput, { recursive: true, force: true })
}
