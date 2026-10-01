// Environment-only isolation; this does not bypass app authentication or RLS.
export function httpTestEnvironment(run, inherited = process.env) {
  const env = {}
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) {
    if (inherited[name] !== undefined) env[name] = inherited[name]
  }
  return {
    ...env,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NARRATIVE_HTTP_TEST_RUN: run,
    // Explicit values override .env.local. Port 9 is never used: at runtime each
    // test injects its own ephemeral mock URL, proving settings are not inlined.
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:9',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-test-publishable',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    RESEARCH_ALLOWED_EMAIL: 'researcher@example.com',
    RESEARCH_SITE_URL: 'http://localhost:9',
  }
}
