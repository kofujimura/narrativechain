import { authorizeResearchAPI, privateJSON } from '../../../../lib/research-api'
import { DocumentError, insertResearchDocument } from '../../../../lib/research-documents'
import { MAX_ARTIFACT_BYTES } from '../../../../lib/artifact-format.mjs'

export async function POST(request: Request) {
  const auth = await authorizeResearchAPI(request)
  if (auth.response || !auth.client) return auth.response!
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return privateJSON({ error: 'json_required' }, 415)
  if (Number(request.headers.get('content-length')) > MAX_ARTIFACT_BYTES) return privateJSON({ error: 'too_large' }, 413)
  const reader = request.body?.getReader()
  if (!reader) return privateJSON({ error: 'invalid_packet' }, 400)
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_ARTIFACT_BYTES) { await reader.cancel(); return privateJSON({ error: 'too_large' }, 413) }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['packet', 'parent_id'].includes(k)) || (input.parent_id !== undefined && input.parent_id !== null && typeof input.parent_id !== 'string')) return privateJSON({ error: 'invalid_packet' }, 400)
    const result = await insertResearchDocument(auth.client, input.packet, input.parent_id ?? null)
    return privateJSON({ ...result, path: `/research/${result.id}` }, result.duplicate ? 200 : 201)
  } catch (error) {
    return error instanceof DocumentError ? privateJSON({ error: error.code }, error.status) : privateJSON({ error: 'invalid_packet' }, 400)
  }
}
