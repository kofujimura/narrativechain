import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeArtifact, renderArtifactHTML, MAX_ARTIFACT_BYTES } from '../lib/artifact-format.mjs'
import { storyPacket, reportPacket } from './artifact-fixtures.mjs'

test('JSON artifacts normalize idempotently; export timestamps do not affect identity', () => {
  for (const packet of [storyPacket(), reportPacket(), reportPacket().report]) {
    const normalized = normalizeArtifact(packet)
    assert.deepEqual(normalizeArtifact(normalized.packet), normalized)
    assert.ok(renderArtifactHTML(normalized.packet).includes('<!doctype html>'))
  }
  const first = normalizeArtifact(storyPacket())
  const later = storyPacket(); later.exported_at = '2026-10-02T00:00:00Z'
  assert.deepEqual(normalizeArtifact(later), first)
})
test('rendered news/model text is inert and internal downloads are removed', () => {
  const packet = storyPacket()
  packet.story.narrative = '<script>alert(1)</script><img src=x onerror=alert(2)>'
  const html = renderArtifactHTML(packet)
  assert.ok(!html.includes('<script>') && !html.includes('<img'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes(' download>'))
  assert.match(html, /default-src 'none'/)
})
test('invalid schemas, links, evidence references, sizes and demo flags fail closed', () => {
  const mutate = change => { const p = storyPacket(); change(p); return p }
  for (const invalid of [null, '<html>', {},
    mutate(p => { p.story.facts[0].url = 'javascript:alert(1)' }),
    mutate(p => { p.story.chain[0].fact_ids = ['invented'] }),
    mutate(p => { p.story.chain[0].condition = '' }),
    mutate(p => { p.story.chain = [] }),
    mutate(p => { p.html = '<html>' }),
    mutate(p => { p.story.narrative = 'x'.repeat(MAX_ARTIFACT_BYTES) }),
    { ...reportPacket(), demo: 'false' },
  ]) assert.throws(() => normalizeArtifact(invalid))
})
