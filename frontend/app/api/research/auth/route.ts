import { authorizeResearchAPI, privateJSON } from '../../../../lib/research-api'

export async function GET(request: Request) {
  const auth = await authorizeResearchAPI(request)
  return auth.response ?? privateJSON({ authenticated: true })
}
