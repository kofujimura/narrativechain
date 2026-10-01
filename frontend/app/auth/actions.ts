'use server'

import { redirect } from 'next/navigation'
import { researchConfig } from '../../lib/research-config'
import { createResearchClient } from '../../lib/supabase-server'

export async function signInWithGoogle() {
  let config
  try { config = researchConfig() } catch { redirect('/login?error=configuration') }
  const supabase = await createResearchClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${config.origin}/auth/callback`,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error || !data.url) redirect('/login?error=authentication')
  redirect(data.url)
}

export async function signOut() {
  const supabase = await createResearchClient()
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) redirect('/login?error=authentication')
  redirect('/login')
}
