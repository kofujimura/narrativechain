-- Run in Supabase SQL Editor as the project administrator, before deploying.
-- This intentionally removes browser access to the old public research tables.
-- No personal account is included. Configure the owner privately AFTER migration.
begin;

create schema if not exists research_private;
revoke all on schema research_private from public, anon, authenticated;

create table if not exists research_private.owner_config (
  singleton boolean primary key default true check (singleton),
  email text not null check (email = lower(btrim(email)) and email like '%@%')
);
revoke all on research_private.owner_config from public, anon, authenticated;

-- SECURITY DEFINER reads protected, server-managed identity data, not user_metadata.
-- No configuration row means FALSE. No allowlist is exposed through the Data API.
create or replace function public.is_research_owner()
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
    and exists (
      select 1
      from research_private.owner_config c
      join auth.users u on u.id = auth.uid()
      join auth.identities i on i.user_id = u.id and i.provider = 'google'
      where c.singleton = true
        and u.email_confirmed_at is not null
        and lower(btrim(u.email)) = c.email
        and lower(btrim(i.identity_data ->> 'email')) = c.email
        and i.identity_data ->> 'email_verified' = 'true'
    ), false
  );
$function$;
revoke all on function public.is_research_owner() from public, anon;
grant execute on function public.is_research_owner() to authenticated;

-- Fail the whole transaction if any expected table is missing.
-- Restrictive gate ANDs with old permissive policies rather than being ORed with them.
do $migration$
declare table_name text;
begin
  foreach table_name in array array['news_articles', 'trigger_events', 'causal_chains', 'chain_nodes'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
    execute format('drop policy if exists research_owner_gate on public.%I', table_name);
    execute format('create policy research_owner_gate on public.%I as restrictive for all to authenticated using ((select public.is_research_owner())) with check ((select public.is_research_owner()))', table_name);
    execute format('drop policy if exists research_owner_read on public.%I', table_name);
    execute format('create policy research_owner_read on public.%I for select to authenticated using ((select public.is_research_owner()))', table_name);
  end loop;
end;
$migration$;

-- Dedicated HTML/JSON storage for a future artifact publisher. Always PRIVATE.
insert into storage.buckets (id, name, public)
values ('research-artifacts', 'research-artifacts', false)
on conflict (id) do update set public = false;

drop policy if exists research_artifact_gate on storage.objects;
create policy research_artifact_gate on storage.objects
as restrictive for all to authenticated
using (bucket_id <> 'research-artifacts' or (select public.is_research_owner()))
with check (bucket_id <> 'research-artifacts');

drop policy if exists research_artifact_no_browser_delete on storage.objects;
create policy research_artifact_no_browser_delete on storage.objects
as restrictive for delete to authenticated
using (bucket_id <> 'research-artifacts');

drop policy if exists research_artifact_anon_gate on storage.objects;
create policy research_artifact_anon_gate on storage.objects
as restrictive for all to anon
using (bucket_id <> 'research-artifacts')
with check (bucket_id <> 'research-artifacts');

drop policy if exists research_artifact_read on storage.objects;
create policy research_artifact_read on storage.objects
for select to authenticated
using (bucket_id = 'research-artifacts' and (select public.is_research_owner()));

commit;
