import 'server-only'
import { configuredSiteOrigin, normalizeEmail } from './auth-policy.mjs'

function runtimeSetting(name: string) {
  return process.env[name]
}

export function researchConfig() {
  // Server-only dynamic lookup: NEXT_PUBLIC_* direct references are frozen by
  // next build, preventing HTTP tests / runtime deployments changing endpoints.
  const url = runtimeSetting('NEXT_PUBLIC_SUPABASE_URL')
  const key = runtimeSetting('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || runtimeSetting('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const allowedEmail = normalizeEmail(runtimeSetting('RESEARCH_ALLOWED_EMAIL'))
  if (!url || !key || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(allowedEmail)) {
    throw new Error('Research site configuration is incomplete')
  }
  return { url, key, allowedEmail, origin: configuredSiteOrigin(runtimeSetting('RESEARCH_SITE_URL')) }
}
