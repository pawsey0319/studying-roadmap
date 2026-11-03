-- 学习路线网站 · 内测云端数据库（Supabase 免费版）
-- 用法：Supabase 控制台 → SQL Editor → 粘贴整个文件 → Run。重复运行不会出错。
--
-- 每个用户的每份个人数据（progress、notes、cards、overlay 等 12 份，见 src/core/schema.js）存一行。
-- 合并在浏览器里做（按每一项的修改时间取新），数据库只负责按用户隔离地存取。

create table if not exists public.docs (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null check (name ~ '^[a-z]{2,20}$'),
  data       jsonb       not null check (jsonb_typeof(data) = 'object' and data ? 'e' and data ? 'mt'),
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

-- 2026-11 起个人数据多了 digests（对话纪要）、method（学习方法档案），名字不再写死在约束里。
-- 已经建过表的项目，运行下面两句即可（重复运行没问题）：
alter table public.docs drop constraint if exists docs_name_check;
alter table public.docs add constraint docs_name_check check (name ~ '^[a-z]{2,20}$');

-- 单份数据最大 2 MB（导入的长文档在 library 里），防止误传超大内容
alter table public.docs drop constraint if exists docs_size;
alter table public.docs add constraint docs_size check (pg_column_size(data) < 2 * 1024 * 1024);

-- 行级安全：每个人只能读写自己的数据。没登录（只有公开的 anon key）什么也查不到。
alter table public.docs enable row level security;

drop policy if exists "docs_select_own" on public.docs;
drop policy if exists "docs_insert_own" on public.docs;
drop policy if exists "docs_update_own" on public.docs;
drop policy if exists "docs_delete_own" on public.docs;

create policy "docs_select_own" on public.docs for select to authenticated using ((select auth.uid()) = user_id);
create policy "docs_insert_own" on public.docs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "docs_update_own" on public.docs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "docs_delete_own" on public.docs for delete to authenticated using ((select auth.uid()) = user_id);

-- anon 角色不需要任何表权限
revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;

-- 自检：下面这句应该返回 4 行策略
-- select policyname, cmd from pg_policies where tablename = 'docs';

-- ============ 内测：管理员提供的学习 Agent 模型（可选） ============
-- 配合 supabase/functions/ai（模型代理）使用：每人每天、每月调用次数计数。
-- 只有模型代理用 secret key 能读写，用户自己读不到也改不了。
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default (now() at time zone 'Asia/Shanghai')::date,
  calls   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- 记一次调用；超过上限返回 ok=false 且不计数
create or replace function public.ai_take(p_user uuid, p_day int, p_month int)
returns json language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; c_day int; c_month int;
begin
  select coalesce(sum(calls) filter (where day = d), 0), coalesce(sum(calls), 0) into c_day, c_month
    from ai_usage where user_id = p_user and day >= date_trunc('month', d)::date;
  if c_day >= p_day or c_month >= p_month then
    return json_build_object('ok', false, 'day', c_day, 'month', c_month);
  end if;
  insert into ai_usage (user_id, day, calls) values (p_user, d, 1)
    on conflict (user_id, day) do update set calls = ai_usage.calls + 1;
  return json_build_object('ok', true, 'day', c_day + 1, 'month', c_month + 1);
end $$;

create or replace function public.ai_peek(p_user uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object('day', coalesce(sum(calls) filter (where day = (now() at time zone 'Asia/Shanghai')::date), 0), 'month', coalesce(sum(calls), 0))
  from ai_usage where user_id = p_user and day >= date_trunc('month', (now() at time zone 'Asia/Shanghai'))::date;
$$;

revoke execute on function public.ai_take(uuid, int, int) from public, anon, authenticated;
revoke execute on function public.ai_peek(uuid) from public, anon, authenticated;
grant execute on function public.ai_take(uuid, int, int) to service_role;
grant execute on function public.ai_peek(uuid) to service_role;

-- 管理员查看用量：select u.email, a.day, a.calls from ai_usage a join auth.users u on u.id = a.user_id order by a.day desc;
