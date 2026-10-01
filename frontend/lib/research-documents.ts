import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeArtifact, validDocumentId } from './artifact-format.mjs'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export class DocumentError extends Error {
  constructor(public code: string, public status: number) { super(code) }
}

export async function insertResearchDocument(client: SupabaseClient, input: unknown, parentId: string | null = null) {
  let artifact
  try { artifact = normalizeArtifact(input) } catch { throw new DocumentError('invalid_packet', 400) }
  if (parentId && (!validDocumentId(parentId) || artifact.kind !== 'investigation')) throw new DocumentError('invalid_parent', 400)
  if (parentId) {
    const { data: parent, error } = await client.from('research_documents').select('id,kind').eq('id', parentId).maybeSingle()
    if (error) throw new DocumentError('database_unavailable', 503)
    if (!parent || parent.kind !== 'story') throw new DocumentError('invalid_parent', 400)
  }
  const hash = createHash('sha256').update(canonical({ packet: artifact.packet, parent_id: parentId })).digest('hex')
  const { data, error } = await client.from('research_documents').insert({ ...artifact, content_hash: hash, parent_id: parentId }).select('id').single()
  if (error?.code === '23505') {
    const existing = await client.from('research_documents').select('id').eq('content_hash', hash).single()
    if (existing.error || !existing.data) throw new DocumentError('database_unavailable', 503)
    return { id: existing.data.id as string, duplicate: true }
  }
  if (error || !data) throw new DocumentError('database_unavailable', 503)
  return { id: data.id as string, duplicate: false }
}
