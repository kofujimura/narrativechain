-- Apply after private_research.sql and google_session.sql.
-- Only the verified owner can read or INSERT. No public access or browser edits.
begin;

create table if not exists public.research_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('story', 'investigation')),
  title text not null check (length(title) between 1 and 500),
  summary text not null check (length(summary) between 1 and 15000),
  packet jsonb not null check (octet_length(packet::text) <= 300000),
  content_hash text not null unique check (content_hash ~ '^[a-f0-9]{64}$'),
  parent_id uuid references public.research_documents(id),
  created_at timestamptz not null default now(),
  check (kind <> 'story' or parent_id is null)
);
create index if not exists research_documents_created_at on public.research_documents(created_at desc);
alter table public.research_documents enable row level security;
revoke all on public.research_documents from public, anon, authenticated;
grant select, insert on public.research_documents to authenticated;
grant all on public.research_documents to service_role;

drop policy if exists research_document_gate on public.research_documents;
create policy research_document_gate on public.research_documents as restrictive for all to authenticated
using ((select public.is_research_owner())) with check ((select public.is_research_owner()));
drop policy if exists research_document_read on public.research_documents;
create policy research_document_read on public.research_documents for select to authenticated
using ((select public.is_research_owner()));
drop policy if exists research_document_insert on public.research_documents;
create policy research_document_insert on public.research_documents for insert to authenticated
with check ((select public.is_research_owner()));

commit;
