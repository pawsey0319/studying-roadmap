-- LH-006/007 additive migration. Run only as the trusted SQL-console owner.
-- No deployment, evaluator, media storage, or automatic admin bootstrap.
begin;
create schema if not exists agent_feedback_private;
revoke all on schema agent_feedback_private from public, anon, authenticated;

create table if not exists public.agent_feedback_admins (
  user_id varchar(64) primary key,
  granted_at timestamptz not null default clock_timestamp()
);
create table if not exists public.agent_feedback (
  owner_id varchar(64) not null,
  id text not null,
  payload jsonb not null check (octet_length(payload::text) <= 16384),
  status text not null default 'submitted' check (status in ('submitted','reviewed','rejected')),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_by varchar(64),
  reviewed_at timestamptz,
  primary key (owner_id, id),
  unique (id)
);
create table if not exists public.agent_release_candidates (
  id text primary key,
  owner_id varchar(64) not null,
  candidate jsonb not null check (octet_length(candidate::text) <= 1048576),
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.agent_release_audit (
  id bigint generated always as identity primary key,
  candidate_id text not null references public.agent_release_candidates(id),
  actor_id varchar(64) not null,
  action text not null,
  old_state text,
  new_state text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}'
);
-- No client policies: default-deny RLS plus no direct SELECT/DML privileges.
-- Definer owner bypasses RLS, so every public RPC explicitly authenticates/authorizes.
alter table public.agent_feedback_admins enable row level security;
alter table public.agent_feedback enable row level security;
alter table public.agent_release_candidates enable row level security;
alter table public.agent_release_audit enable row level security;
revoke all on public.agent_feedback_admins, public.agent_feedback,
  public.agent_release_candidates, public.agent_release_audit from public, anon, authenticated;
revoke all on sequence public.agent_release_audit_id_seq from public, anon, authenticated;

create or replace function agent_feedback_private.require_user() returns varchar
language plpgsql set search_path = pg_catalog as $$
declare u varchar(64) := auth.uid();
begin
  if u is null or u = '' then raise exception 'AUTH_REQUIRED'; end if;
  return u;
end $$;
create or replace function agent_feedback_private.require_admin() returns varchar
language plpgsql set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_user();
begin
  if not exists (select 1 from public.agent_feedback_admins where user_id = u) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  return u;
end $$;
-- Exact keys (including required keys); no unknown fields survive sanitization.
create or replace function agent_feedback_private.exact_keys(v jsonb, keys text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(v) = 'object' then
    v ?& keys and (v - keys) = '{}'::jsonb else false end
$$;
create or replace function agent_feedback_private.valid_text(v jsonb, lo integer, hi integer) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_typeof(v) = 'string' and char_length(v #>> '{}') between lo and hi
    and (v #>> '{}') !~* '(data:|blob:|;base64,)', false)
$$;
create or replace function agent_feedback_private.valid_id(v jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[A-Za-z0-9_.:-]{1,100}$', false)
$$;
create or replace function agent_feedback_private.valid_time(v jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between 0 and 9007199254740991 else false end
$$;
create or replace function agent_feedback_private.validate_payload(p jsonb) returns void
language plpgsql set search_path = pg_catalog as $$
declare f jsonb; k text; title jsonb; allowed text[] := array['rating','reason','note','excerpt','context','sourceTitles'];
begin
  if p is null or octet_length(p::text) > 16384 or not agent_feedback_private.exact_keys(p,
    array['schema','id','sessionId','spec','at','fields','material','consent']) then
    raise exception 'INVALID_FEEDBACK_PAYLOAD';
  end if;
  if p->>'schema' is distinct from 'lh-quality-feedback/1'
    or not agent_feedback_private.valid_id(p->'id')
    or not (p->'sessionId' = '""'::jsonb or agent_feedback_private.valid_id(p->'sessionId'))
    or not agent_feedback_private.valid_text(p->'spec',1,100)
    or not agent_feedback_private.valid_time(p->'at') then raise exception 'INVALID_FEEDBACK_PAYLOAD'; end if;
  if jsonb_typeof(p->'fields') is distinct from 'array' or jsonb_typeof(p->'material') is distinct from 'object'
    or not agent_feedback_private.exact_keys(p->'consent',array['confirmed','previewId','fields']) then
    raise exception 'QUALITY_CONSENT_MISMATCH';
  end if;
  if p#>'{consent,confirmed}' is distinct from 'true'::jsonb
    or p#>'{consent,previewId}' is distinct from p->'id'
    or p#>'{consent,fields}' is distinct from p->'fields'
    or jsonb_array_length(p->'fields') > 6 then raise exception 'QUALITY_CONSENT_MISMATCH'; end if;
  if (select count(*) <> count(distinct value) from jsonb_array_elements(p->'fields')) then
    raise exception 'INVALID_SHARED_FIELD';
  end if;
  for f in select value from jsonb_array_elements(p->'fields') loop
    if jsonb_typeof(f) <> 'string' or not ((f #>> '{}') = any(allowed)) then raise exception 'INVALID_SHARED_FIELD'; end if;
  end loop;
  if not agent_feedback_private.exact_keys(p->'material',array(select jsonb_array_elements_text(p->'fields'))) then
    raise exception 'QUALITY_CONSENT_MISMATCH';
  end if;
  for k, f in select key, value from jsonb_each(p->'material') loop
    if k = 'rating' then
      if f not in ('"up"'::jsonb,'"down"'::jsonb) then raise exception 'INVALID_RATING'; end if;
    elsif k = 'sourceTitles' then
      if jsonb_typeof(f) <> 'array' then raise exception 'INVALID_SOURCE_TITLES'; end if;
      if jsonb_array_length(f) > 8 then raise exception 'INVALID_SOURCE_TITLES'; end if;
      for title in select value from jsonb_array_elements(f) loop
        if not agent_feedback_private.valid_text(title,0,120) then raise exception 'INVALID_SOURCE_TITLES'; end if;
      end loop;
    elsif not agent_feedback_private.valid_text(f,0,case when k = 'excerpt' then 1000 else 600 end) then
      raise exception 'INVALID_SHARED_TEXT';
    end if;
  end loop;
end $$;

create or replace function public.agent_feedback_submit(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_user();
begin
  perform agent_feedback_private.validate_payload(p_payload);
  -- Plain INSERT, not upsert: an old/in-flight submit cannot overwrite existing consent.
  insert into public.agent_feedback(owner_id,id,payload) values (u,p_payload->>'id',p_payload);
  return jsonb_build_object('id',p_payload->>'id','status','submitted');
end $$;
create or replace function public.agent_feedback_list() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_user(); result jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(f) - 'owner_id' order by f.created_at desc),'[]'::jsonb)
    into result from public.agent_feedback f where f.owner_id = u;
  return jsonb_build_object('feedback',result);
end $$;
create or replace function public.agent_feedback_delete(p_id text) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_user();
begin
  -- Per-row ownership, even for admins; no media/evaluation sample tables exist here.
  delete from public.agent_feedback where id = p_id and owner_id = u;
  if not found then raise exception 'FEEDBACK_NOT_FOUND'; end if;
  return jsonb_build_object('id',p_id,'deleted',true);
end $$;
create or replace function public.agent_feedback_admin_list() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_admin(); result jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]'::jsonb) into result from public.agent_feedback f;
  return jsonb_build_object('feedback',result);
end $$;
create or replace function public.agent_feedback_review(p_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_admin();
begin
  if p_status is null or p_status not in ('reviewed','rejected') then raise exception 'INVALID_FEEDBACK_STATUS'; end if;
  update public.agent_feedback set status = p_status, reviewed_by = u, reviewed_at = clock_timestamp() where id = p_id;
  if not found then raise exception 'FEEDBACK_NOT_FOUND'; end if;
  return jsonb_build_object('id',p_id,'status',p_status);
end $$;
create or replace function public.agent_release_list() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_admin(); result jsonb;
begin
  select coalesce(jsonb_agg(candidate order by created_at desc),'[]'::jsonb) into result from public.agent_release_candidates;
  return jsonb_build_object('candidates',result);
end $$;
create or replace function public.agent_release_candidate(p_candidate jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_admin(); c jsonb; t jsonb;
begin
  if p_candidate is null or octet_length(p_candidate::text) > 16384 or not agent_feedback_private.exact_keys(p_candidate,
    array['schema','id','spec','modelRevision','summary','state','evaluation','rollout','history','productionCredentials']) then
    raise exception 'INVALID_CANDIDATE';
  end if;
  if p_candidate->>'schema' is distinct from 'lh-agent-release/1'
    or not agent_feedback_private.valid_id(p_candidate->'id')
    or not agent_feedback_private.valid_text(p_candidate->'spec',1,100)
    or not agent_feedback_private.valid_text(p_candidate->'modelRevision',1,100)
    or not agent_feedback_private.valid_text(p_candidate->'summary',0,1000)
    or p_candidate->>'state' is distinct from 'candidate'
    or p_candidate->'evaluation' is distinct from 'null'::jsonb
    or p_candidate->'rollout' is distinct from '0'::jsonb
    or p_candidate->'productionCredentials' is distinct from 'false'::jsonb
    or jsonb_typeof(p_candidate->'history') is distinct from 'array' then raise exception 'INVALID_CANDIDATE'; end if;
  if jsonb_array_length(p_candidate->'history') <> 1 then raise exception 'INVALID_CANDIDATE'; end if;
  t := p_candidate#>'{history,0}';
  if not agent_feedback_private.exact_keys(t,array['action','at']) or t->>'action' is distinct from 'candidate'
    or not agent_feedback_private.valid_time(t->'at') then raise exception 'INVALID_CANDIDATE'; end if;
  -- Ignore client history timestamp; all authoritative audit times/actors come from DB.
  c := jsonb_set(p_candidate,'{history}',jsonb_build_array(jsonb_build_object('action','candidate','actorId',u,'at',floor(extract(epoch from clock_timestamp())*1000))));
  insert into public.agent_release_candidates(id,owner_id,candidate) values (c->>'id',u,c);
  insert into public.agent_release_audit(candidate_id,actor_id,action,new_state) values(c->>'id',u,'candidate','candidate');
  return c;
end $$;
create or replace function public.agent_release_advance(p_id text, p_action text, p_options jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare u varchar(64) := agent_feedback_private.require_admin(); c jsonb; s text; n text; r numeric; previous text; entry jsonb;
begin
  -- Intentionally before evaluation parsing: never accept frontend passed/evaluation.
  if p_action = 'evaluate' then raise exception 'EVALUATOR_NOT_CONFIGURED'; end if;
  if p_action = 'approve' then raise exception 'TRUSTED_EVALUATION_REQUIRED'; end if;
  if p_options is null or jsonb_typeof(p_options) <> 'object'
    or (p_options - array['at','evaluation','rollout','previousReleaseId']) <> '{}'::jsonb
    or (p_options ? 'evaluation' and p_options->'evaluation' <> 'null'::jsonb)
    then raise exception 'UNTRUSTED_EVALUATION_OR_OPTIONS'; end if;
  if p_options ? 'at' and not agent_feedback_private.valid_time(p_options->'at') then raise exception 'INVALID_TIME'; end if;
  select candidate into c from public.agent_release_candidates where id = p_id for update;
  if not found then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  s := c->>'state'; n := s;
  if p_action = 'review' and s = 'candidate' then n := 'reviewed';
  elsif p_action = 'reject' and s in ('candidate','reviewed','evaluated','approved') then n := 'rejected';
  elsif p_action = 'canary' and s in ('approved','canary') then
    if jsonb_typeof(p_options->'rollout') is distinct from 'number' then raise exception 'INVALID_ROLLOUT'; end if;
    r := (p_options->>'rollout')::numeric;
    if r <> trunc(r) or r < 1 or r > 99 or r < (c->>'rollout')::numeric then raise exception 'INVALID_ROLLOUT'; end if;
    if not agent_feedback_private.valid_id(p_options->'previousReleaseId') then raise exception 'ROLLBACK_TARGET_REQUIRED'; end if;
    previous := p_options->>'previousReleaseId';
    if previous = p_id or not exists (select 1 from public.agent_release_candidates where id = previous and candidate->>'state' = 'released') then
      raise exception 'INVALID_ROLLBACK_TARGET';
    end if;
    if s = 'canary' and previous is distinct from c->>'previousReleaseId' then raise exception 'ROLLBACK_TARGET_IMMUTABLE'; end if;
    n := 'canary'; c := c || jsonb_build_object('rollout',r,'previousReleaseId',previous);
  elsif p_action = 'release' and s = 'canary' then n := 'released'; c := c || jsonb_build_object('rollout',100);
  elsif p_action = 'rollback' and s in ('canary','released') then
    if not agent_feedback_private.valid_id(c->'previousReleaseId') then raise exception 'ROLLBACK_TARGET_REQUIRED'; end if;
    n := 'rolled_back'; c := c || jsonb_build_object('rollout',0,'rollbackTarget',c->>'previousReleaseId',
      'rollbackNotice','仅回退后续配置，不撤销已执行的数据变更');
  else raise exception 'INVALID_RELEASE_TRANSITION'; end if;
  entry := jsonb_build_object('action',p_action,'actorId',u,'at',floor(extract(epoch from clock_timestamp())*1000));
  c := c || jsonb_build_object('state',n,'history',(c->'history') || jsonb_build_array(entry),'productionCredentials',false);
  update public.agent_release_candidates set candidate = c where id = p_id;
  insert into public.agent_release_audit(candidate_id,actor_id,action,old_state,new_state,details)
    values(p_id,u,p_action,s,n,jsonb_build_object('rollout',c->'rollout','previousReleaseId',c->'previousReleaseId','recordOnly',true));
  return c;
end $$;

-- Helper routines cannot be called through RPC. Admin membership has NO write RPC.
revoke all on all functions in schema agent_feedback_private from public, anon, authenticated;
revoke all on function public.agent_feedback_submit(jsonb), public.agent_feedback_list(),
  public.agent_feedback_delete(text), public.agent_feedback_admin_list(), public.agent_feedback_review(text,text),
  public.agent_release_list(), public.agent_release_candidate(jsonb), public.agent_release_advance(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_feedback_submit(jsonb), public.agent_feedback_list(),
  public.agent_feedback_delete(text), public.agent_feedback_admin_list(), public.agent_feedback_review(text,text),
  public.agent_release_list(), public.agent_release_candidate(jsonb), public.agent_release_advance(text,text,jsonb)
  to authenticated;
commit;
