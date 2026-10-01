import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../../db/migrations/20261001_private_research.sql', import.meta.url), 'utf8')
const sessionMigration = await readFile(new URL('../../db/migrations/20261001_google_session.sql', import.meta.url), 'utf8')
const tables = ['news_articles', 'trigger_events', 'causal_chains', 'chain_nodes']
const ownerId = '00000000-0000-0000-0000-000000000001'
const otherId = '00000000-0000-0000-0000-000000000002'
const ownerSession = '00000000-0000-0000-0000-000000000010'
const otherSession = '00000000-0000-0000-0000-000000000020'

test('PostgreSQL RLS denies anon/non-owner even with legacy allow-all policies', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      grant usage on schema auth, storage to anon, authenticated, service_role;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      create table auth.identities (user_id uuid, provider text, identity_data jsonb);
      create table auth.sessions (id uuid primary key, user_id uuid, not_after timestamptz);
      create table auth.mfa_amr_claims (session_id uuid, authentication_method text);
      create table storage.buckets (id text primary key, name text, public boolean);
      create table storage.objects (id int primary key, bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant all on storage.objects to anon, authenticated, service_role;
      create policy legacy_storage_all on storage.objects for all to anon, authenticated using (true) with check (true);
      insert into storage.buckets values ('research-artifacts', 'research-artifacts', true);
      insert into storage.objects values (1, 'research-artifacts', 'private.html'), (2, 'other', 'unrelated.txt');
    `)
    for (const table of tables) await db.exec(`
      create table public.${table} (id int primary key, secret text);
      insert into public.${table} values (1, 'private research');
      grant all on public.${table} to anon, authenticated;
      alter table public.${table} enable row level security;
      create policy legacy_all on public.${table} for all to anon, authenticated using (true) with check (true);
    `)
    await db.exec(migration)
    await db.exec(migration) // Idempotent; no owner is hardcoded or reset.
    await db.exec(sessionMigration)
    await db.exec(sessionMigration)
    assert.equal((await db.query("select public from storage.buckets where id = 'research-artifacts'")).rows[0].public, false)
    await db.query('insert into auth.users values ($1, $2, now()), ($3, $4, now())', [ownerId, 'researcher@example.com', otherId, 'other@example.com'])
    for (const [id, email] of [[ownerId, 'researcher@example.com'], [otherId, 'other@example.com']]) {
      await db.query('insert into auth.identities values ($1, $2, $3)', [id, 'google', JSON.stringify({ email, email_verified: true })])
    }
    await db.query('insert into auth.sessions values ($1, $2, null), ($3, $4, null)', [ownerSession, ownerId, otherSession, otherId])
    await db.query("insert into auth.mfa_amr_claims values ($1, 'oauth'), ($2, 'oauth')", [ownerSession, otherSession])

    async function as(role, id, provider = 'google', patch = {}) {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role, is_anonymous: false, session_id: id === ownerId ? ownerSession : otherSession, amr: [{ method: 'oauth' }], app_metadata: { provider }, ...patch })])
      await db.exec(`set role ${role}`)
    }
    await as('authenticated', ownerId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
    for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0)
    await db.exec('reset role')
    await db.query('insert into research_private.owner_config (email) values ($1)', ['researcher@example.com'])

    await as('anon', null)
    for (const table of tables) await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
    assert.deepEqual((await db.query('select id from storage.objects')).rows, [{ id: 2 }])
    await assert.rejects(db.query('select public.is_research_owner()'), /permission denied/)

    await as('authenticated', otherId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
    for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0)
    assert.deepEqual((await db.query('select id from storage.objects')).rows, [{ id: 2 }])
    await assert.rejects(db.query('select * from research_private.owner_config'), /permission denied/)

    await as('authenticated', ownerId, 'email')
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, true)
    for (const patch of [
      { amr: [{ method: 'password' }] }, { amr: [] }, { amr: null }, { amr: {} },
      { amr: [{ method: 'oauth', provider: 'github' }] }, { amr: [{ method: 'oauth' }, { method: 'invite' }] },
      { session_id: 'invalid' }, { session_id: otherSession }, { session_id: '00000000-0000-0000-0000-000000000030' },
      { is_anonymous: true },
    ]) {
      await as('authenticated', ownerId, 'email', patch)
      assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
      for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0)
      assert.deepEqual((await db.query('select id from storage.objects')).rows, [{ id: 2 }])
    }
    await db.exec('reset role')
    await db.query("insert into auth.identities values ($1, 'email', $2)", [ownerId, JSON.stringify({ email: 'researcher@example.com' })])
    await db.query("insert into auth.identities values ($1, 'github', $2)", [ownerId, '{}'])
    await as('authenticated', ownerId, 'email')
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
    await db.exec('reset role')
    await db.exec("delete from auth.identities where provider = 'github'")
    // A forged OAuth claim cannot authorize a real password/recovery session.
    await db.query("update auth.mfa_amr_claims set authentication_method = 'password' where session_id = $1", [ownerSession])
    await as('authenticated', ownerId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
    await db.exec('reset role')
    await db.query("update auth.mfa_amr_claims set authentication_method = 'oauth' where session_id = $1", [ownerSession])
    await db.query("update auth.sessions set not_after = now() - interval '1 minute' where id = $1", [ownerSession])
    await as('authenticated', ownerId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
    await db.exec('reset role')
    await db.query('update auth.sessions set not_after = null where id = $1', [ownerSession])
    await as('authenticated', ownerId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, true)
    for (const table of tables) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length, 1)
      await assert.rejects(db.query(`insert into ${table} values (2, 'browser write')`), /permission denied/)
    }
    assert.equal((await db.query('select * from storage.objects')).rows.length, 2)
    await assert.rejects(db.query("insert into storage.objects values (3, 'research-artifacts', 'browser.html')"), /row-level security/)
    await db.exec("delete from storage.objects where bucket_id = 'research-artifacts'")
    assert.equal((await db.query("select * from storage.objects where bucket_id = 'research-artifacts'")).rows.length, 1)

    await as('service_role', null)
    for (const table of tables) await db.exec(`insert into ${table} values (3, 'agent write')`)
    await db.exec("insert into storage.objects values (3, 'research-artifacts', 'agent.html')")

    await db.exec('reset role')
    await db.exec("update auth.identities set identity_data = '{\"email\":\"researcher@example.com\",\"email_verified\":false}' where user_id = '00000000-0000-0000-0000-000000000001'")
    await as('authenticated', ownerId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
    await db.exec('reset role')
    await db.query("update auth.identities set identity_data = $1 where user_id = $2 and provider = 'google'", [JSON.stringify({ email: 'researcher@example.com', email_verified: true }), ownerId])
    await db.query('delete from auth.sessions where id = $1', [ownerSession])
    await as('authenticated', ownerId)
    assert.equal((await db.query('select public.is_research_owner() as allowed')).rows[0].allowed, false)
  } finally { await db.close() }
})
