import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelSettings, budgetStatus, budgetDirectory } from '../api-client.js'
import { cost, reserve, committed } from '../budget.js'
import { buildImpactRequest, IMPACT_MODEL } from '../../agents/impactPolicy.js'

test('Sol defaults, supported effort, and independent environment overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narrative-model-test-'))
  const saved = [process.env.OPENAI_MODEL, process.env.OPENAI_FILTER_MODEL]
  try {
    delete process.env.OPENAI_MODEL; delete process.env.OPENAI_FILTER_MODEL
    assert.deepEqual(await modelSettings(dir), { filter: 'gpt-6.1-sol', generation: 'gpt-6.1-sol' })
    assert.equal(IMPACT_MODEL, 'gpt-6.1-sol')
    assert.equal(buildImpactRequest([]).reasoning.effort, 'low')
    await writeFile(join(dir, '.env.local'), 'OPENAI_MODEL=file-model\nOPENAI_FILTER_MODEL=file-filter\n')
    assert.deepEqual(await modelSettings(dir), { filter: 'file-filter', generation: 'file-model' })
    process.env.OPENAI_MODEL = 'process-model'
    assert.equal((await modelSettings(dir)).generation, 'process-model')
  } finally {
    for (const [i, key] of ['OPENAI_MODEL', 'OPENAI_FILTER_MODEL'].entries()) { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i] }
    await rm(dir, { recursive: true })
  }
})

test('without research directory use local budget; existing legacy budget never resets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narrative-budget-test-'))
  try {
    assert.equal((await budgetDirectory(dir)).legacy, false)
    assert.equal((await budgetStatus(dir)).remaining, 1600)
    const legacy = join(dir, 'research/data/llm-budget')
    await mkdir(legacy, { recursive: true })
    await assert.rejects(budgetStatus(dir)) // Missing legacy ledger is not silently recreated.
    await writeFile(join(legacy, 'ledger.json'), JSON.stringify({ cap_jpy: 1600, calls: [{ charged_jpy: 129.43446 }] }))
    assert.equal((await budgetDirectory(dir)).legacy, true)
    assert.equal((await budgetStatus(dir)).remaining, 1470.56554)
  } finally { await rm(dir, { recursive: true }) }
})

test('Sol budget includes cache-write cushion and preserves cumulative cap', () => {
  assert.equal(cost('gpt-6.1-sol', 1000000, 0), 1200)
  assert.equal(cost('gpt-6.1-sol', 1000, 1000), 3)
  assert.equal(cost('gpt-5.6-sol', 1000000, 0), 2400) // Long input doubles rate.
  assert.equal(cost('gpt-5.6-sol', 1000, 1000), 6)
  const ledger = { cap_jpy: 1600, calls: [] }
  const request = { model: 'gpt-6.1-sol', input: 'test', max_output_tokens: 5000 }
  reserve(ledger, 'one', request)
  assert.ok(committed(ledger) > 12)
  assert.throws(() => reserve({ cap_jpy: 1, calls: [] }, 'two', request), /budget/)
  assert.throws(() => cost('unknown-model', 100, 100))
})
