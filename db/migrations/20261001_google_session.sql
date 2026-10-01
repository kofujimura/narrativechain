-- Apply AFTER 20261001_private_research.sql. Preserves users, owner config,
-- existing research data, RLS policies and bucket permissions. No personal data.
begin;

-- app_metadata.provider describes FIRST signup, not this session's login.
-- Use Auth-managed OAuth AMR + live session + verified Google identity instead.
-- OAuth AMR does not identify the provider: Google must be the ONLY enabled
-- OAuth provider for this research project. Other linked identities fail closed.
create or replace function public.is_research_owner()
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select coalesce(
    (auth.jwt() ->> 'role') = 'authenticated'
    and (auth.jwt() ->> 'is_anonymous') = 'false'
    and (auth.jwt() -> 'amr') @> '[{"method":"oauth"}]'::jsonb
    and not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
          then auth.jwt() -> 'amr' else '[]'::jsonb end
      ) a
      where coalesce(a ->> 'method', '') not in
        ('oauth', 'totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code', 'token_refresh')
        or (a ->> 'method' = 'oauth' and a ? 'provider' and (a ->> 'provider') is distinct from 'google')
    )
    and exists (
      select 1
      from research_private.owner_config c
      join auth.users u on u.id = auth.uid()
      join auth.identities i on i.user_id = u.id and i.provider = 'google'
      join auth.sessions s on s.user_id = u.id
        and s.id::text = auth.jwt() ->> 'session_id'
      where c.singleton = true
        and u.email_confirmed_at is not null
        and lower(btrim(u.email)) = c.email
        and lower(btrim(i.identity_data ->> 'email')) = c.email
        and i.identity_data ->> 'email_verified' = 'true'
        and (s.not_after is null or s.not_after > now())
        and exists (
          select 1 from auth.mfa_amr_claims m
          where m.session_id = s.id and m.authentication_method = 'oauth'
        )
        and not exists (
          select 1 from auth.mfa_amr_claims m
          where m.session_id = s.id and coalesce(m.authentication_method, '') not in
            ('oauth', 'totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code', 'token_refresh')
        )
        and not exists (
          select 1 from auth.identities other
          where other.user_id = u.id
            and coalesce(other.provider, '') not in ('email', 'google')
        )
    ), false
  );
$function$;
revoke all on function public.is_research_owner() from public, anon;
grant execute on function public.is_research_owner() to authenticated;

commit;
