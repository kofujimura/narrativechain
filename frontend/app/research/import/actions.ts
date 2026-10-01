'use server'

import { redirect } from 'next/navigation'
import { requireResearchOwner } from '../../../lib/research-auth'
import { DocumentError, insertResearchDocument } from '../../../lib/research-documents'
import { MAX_ARTIFACT_BYTES } from '../../../lib/artifact-format.mjs'

export async function importArtifact(formData: FormData) {
  const client = await requireResearchOwner()
  const file = formData.get('packet')
  const parent = formData.get('parent')
  if (!(file instanceof File) || file.size > MAX_ARTIFACT_BYTES || !file.name.toLowerCase().endsWith('.json') || (parent !== null && typeof parent !== 'string')) redirect('/research/import?error=invalid_packet')
  let result
  try { result = await insertResearchDocument(client, JSON.parse(await file.text()), parent || null) }
  catch (error) { redirect(`/research/import?error=${error instanceof DocumentError ? error.code : 'invalid_packet'}`) }
  redirect(`/research/${result.id}`)
}
