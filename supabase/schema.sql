-- 学习路线网站 · 内测云端数据库（Supabase 免费版）
-- 用法：Supabase 控制台 → SQL Editor → 粘贴整个文件 → Run。重复运行不会出错。
--
-- 每个用户的每份个人数据（progress、notes、cards、overlay 等 12 份，见 src/core/schema.js）存一行。
-- 合并在浏览器里做（按每一项的修改时间取新），数据库只负责按用户隔离地存取。

create table if not exists public.docs (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null check (name in ('progress','notes','cards','overlay','read','later','routes','tracks','library','sugs','marks','meta')),
  data       jsonb       not null check (jsonb_typeof(data) = 'object' and data ? 'e' and data ? 'mt'),
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

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
