import { symlink, readlink, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills')
const target = join(directory, 'narrative-investigation'), source = join(root, 'skills/narrative-investigation')
await mkdir(directory, { recursive: true })
try { await symlink(source, target, 'dir'); console.log(`スキルを登録しました: ${target}`) }
catch (e) { if (e.code === 'EEXIST' && await readlink(target).catch(() => '') === source) console.log('同じスキルが登録済みです。'); else throw Error('既存のスキルを上書きしません。登録先を確認してください。') }
