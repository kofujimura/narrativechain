import { authorizeResearchAPI, privateJSON } from '../../../../../lib/research-api'
import { normalizeArtifact, validDocumentId } from '../../../../../lib/artifact-format.mjs'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeResearchAPI(request)
  if (auth.response || !auth.client) return auth.response!
  const { id } = await params
  if (!validDocumentId(id)) return privateJSON({ error: 'not_found' }, 404)
  const { data, error } = await auth.client.from('research_documents').select('packet').eq('id', id).maybeSingle()
  if (error) return privateJSON({ error: 'database_unavailable' }, 503)
  if (!data) return privateJSON({ error: 'not_found' }, 404)
  try {
    const response = privateJSON(normalizeArtifact(data.packet).packet)
    response.headers.set('Content-Disposition', `attachment; filename="${id}.json"`)
    return response
  } catch { return privateJSON({ error: 'invalid_stored_packet' }, 503) }
}
