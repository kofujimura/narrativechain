import { researchConfig } from '../../../../lib/research-config'
import { privateJSON } from '../../../../lib/research-api'

export function GET() {
  try {
    const { url, key } = researchConfig()
    // These are public Auth connection settings, NEVER owner email or secrets.
    return privateJSON({ supabase_url: url, publishable_key: key })
  } catch { return privateJSON({ error: 'configuration' }, 503) }
}
