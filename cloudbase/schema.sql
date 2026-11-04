-- 学习网站 v3 · 腾讯云开发 CloudBase（PostgreSQL 模式）数据库
-- 用法：CloudBase 控制台 → 数据库 → PostgreSQL → SQL 编辑器 → 粘贴整个文件 → 执行。重复执行不会出错。
-- 如果编辑器一次只能执行一条语句，按“-- ====”分段，一段一段执行。
--
-- 和 Supabase 版（supabase/schema.sql）的区别：
--   · 用户 ID 是文本（varchar(64)），默认取 auth.uid()；
--   · 修改时间和版本号由数据库给（触发器），不用设备时钟——同步时按 updated_at 增量拉取，按 rev 判断长文档是否冲突；
--   · 新增公共区域的三张表：公开的内容、采用记录、举报。公共区域只在服务端，不走离线同步。

-- ==== 1. 个人数据：每个用户每份数据一行 ====
create table if not exists public.docs (
  user_id    varchar(64) not null default auth.uid(),
  name       text        not null check (name ~ '^[a-z]{2,20}$'),
  data       jsonb       not null check (jsonb_typeof(data) = 'object' and data ? 'e' and data ? 'mt'),
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);
alter table public.docs drop constraint if exists docs_size;
alter table public.docs add constraint docs_size check (pg_column_size(data) < 2 * 1024 * 1024);
create index if not exists docs_user_updated on public.docs (user_id, updated_at);

-- 服务端时间和版本号：每次写入都由数据库重新给，客户端传什么都不算
create or replace function public.docs_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.rev := old.rev + 1;
    new.user_id := old.user_id;
  else
    new.rev := 1;
  end if;
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.docs_touch();

alter table public.docs enable row level security;
drop policy if exists docs_own on public.docs;
create policy docs_own on public.docs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;

-- ==== 2. 公共区域：公开的路线和笔记（快照） ====
create table if not exists public.public_items (
  id          bigserial   primary key,
  author      varchar(64) not null default auth.uid(),
  author_name text        not null check (char_length(author_name) between 1 and 40),
  kind        text        not null check (kind in ('track', 'note')),
  track       text        check (track is null or track ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  title       text        not null check (char_length(title) between 1 and 120),
  summary     text        not null default '' check (char_length(summary) <= 600),
  body        jsonb       not null check (pg_column_size(body) < 1024 * 1024),
  version     int         not null default 1,
  status      text        not null default 'published' check (status in ('published', 'hidden', 'removed')),
  adopt_count int         not null default 0,
  done_count  int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists public_items_list on public.public_items (status, kind, track, updated_at desc);

-- 作者只能改内容和“公开/隐藏”；被管理员下架（removed）的不能自己恢复；计数只能由下面的函数改
create or replace function public.public_items_guard() returns trigger language plpgsql as $$
begin
  -- 采用计数由下面的计数函数改，放行（它会先设置 app.counting）
  if tg_op = 'UPDATE' and current_setting('app.counting', true) = '1' then return new; end if;
  if auth.role() = 'service_role' then new.updated_at := clock_timestamp(); return new; end if;
  if tg_op = 'INSERT' then
    new.author := auth.uid(); new.status := 'published'; new.version := 1;
    new.adopt_count := 0; new.done_count := 0;
  else
    if old.status = 'removed' then raise exception '这条内容已被下架，不能修改'; end if;
    if new.status not in ('published', 'hidden') then new.status := old.status; end if;
    new.author := old.author; new.adopt_count := old.adopt_count; new.done_count := old.done_count;
    new.created_at := old.created_at;
    if new.body is distinct from old.body then new.version := old.version + 1; else new.version := old.version; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists public_items_guard on public.public_items;
create trigger public_items_guard before insert or update on public.public_items for each row execute function public.public_items_guard();

alter table public.public_items enable row level security;
drop policy if exists pi_read on public.public_items;
drop policy if exists pi_insert on public.public_items;
drop policy if exists pi_update on public.public_items;
drop policy if exists pi_delete on public.public_items;
create policy pi_read   on public.public_items for select to authenticated using (status = 'published' or author = auth.uid());
create policy pi_insert on public.public_items for insert to authenticated with check (author = auth.uid());
create policy pi_update on public.public_items for update to authenticated using (author = auth.uid()) with check (author = auth.uid());
create policy pi_delete on public.public_items for delete to authenticated using (author = auth.uid());
revoke all on public.public_items from anon;
grant select, insert, update, delete on public.public_items to authenticated;
grant usage, select on sequence public.public_items_id_seq to authenticated;

-- ==== 3. 采用记录：谁采用了哪条的哪个版本；学完了也记一笔（用于“采用后完成率”排序） ====
create table if not exists public.adoptions (
  item_id    bigint      not null references public.public_items (id) on delete cascade,
  user_id    varchar(64) not null default auth.uid(),
  version    int         not null,
  done       boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
alter table public.adoptions enable row level security;
drop policy if exists ad_own on public.adoptions;
create policy ad_own on public.adoptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.adoptions from anon;
grant select, insert, update, delete on public.adoptions to authenticated;

-- 采用和“学完”的计数由触发器维护（security definer：普通用户不能直接改计数）
create or replace function public.adoptions_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.counting', '1', true);
  if tg_op = 'INSERT' then
    update public_items set adopt_count = adopt_count + 1, done_count = done_count + (case when new.done then 1 else 0 end) where id = new.item_id;
  elsif tg_op = 'UPDATE' then
    if new.done is distinct from old.done then
      update public_items set done_count = greatest(0, done_count + (case when new.done then 1 else -1 end)) where id = new.item_id;
    end if;
  elsif tg_op = 'DELETE' then
    update public_items set adopt_count = greatest(0, adopt_count - 1), done_count = greatest(0, done_count - (case when old.done then 1 else 0 end)) where id = old.item_id;
  end if;
  perform set_config('app.counting', '', true);
  return null;
end $$;
drop trigger if exists adoptions_count on public.adoptions;
create trigger adoptions_count after insert or update or delete on public.adoptions for each row execute function public.adoptions_count();

-- ==== 4. 举报：任何登录用户都能提交，只有管理员（控制台）能看 ====
create table if not exists public.reports (
  id         bigserial   primary key,
  item_id    bigint      not null references public.public_items (id) on delete cascade,
  reporter   varchar(64) not null default auth.uid(),
  reason     text        not null check (char_length(reason) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (item_id, reporter)
);
alter table public.reports enable row level security;
drop policy if exists rp_insert on public.reports;
create policy rp_insert on public.reports for insert to authenticated with check (reporter = auth.uid());
revoke all on public.reports from anon, authenticated;
grant insert on public.reports to authenticated;
grant usage, select on sequence public.reports_id_seq to authenticated;

-- ==== 5. 自检（单独执行，看结果） ====
-- 应该看到 docs、public_items、adoptions、reports 四张表，且 rowsecurity 都是 true：
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
-- 后面要用到的扩展是否可用（有 installed_version 或 default_version 就行）：
--   select name, default_version, installed_version from pg_available_extensions
--   where name in ('vector', 'pg_jieba', 'zhparser', 'pg_cron') order by name;
-- 管理员下架一条公开内容：update public_items set status = 'removed' where id = <ID>;
-- 管理员查看举报：select r.*, p.title from reports r join public_items p on p.id = r.item_id order by r.created_at desc;

-- ==== 6. 财经快讯与热榜（tools/fetch_hot.py 写入，所有人可读） ====
create table if not exists public.hot_items (
  id         text        primary key,
  source     text        not null,
  title      text        not null,
  url        text        not null check (url ~ '^https?://'),
  time       text        not null default '',
  rank       int         not null default 0,
  fetched_at timestamptz not null default now()
);
create index if not exists hot_items_src on public.hot_items (source, fetched_at desc, rank);
alter table public.hot_items enable row level security;
drop policy if exists hot_read on public.hot_items;
create policy hot_read on public.hot_items for select to anon, authenticated using (true);
revoke all on public.hot_items from anon, authenticated;
grant select on public.hot_items to anon, authenticated;

-- ==== 7. 资讯条目（tools/miniflux_sync.py 从 Miniflux 同步过来，所有人可读） ====
create table if not exists public.news_items (
  id         text        primary key,            -- 'n' + 链接哈希，和网页里的资讯 ID 一致
  d          date        not null,
  src        text        not null,
  lvl        text        not null default 'B' check (lvl in ('A', 'B', 'C')),
  k          text[]      not null default '{}',
  t          text        not null,
  s          text        not null default '',
  u          text        not null check (u ~ '^https?://'),
  via        text,
  fetched_at timestamptz not null default now()
);
create index if not exists news_items_d on public.news_items (d desc);
alter table public.news_items enable row level security;
drop policy if exists news_read on public.news_items;
create policy news_read on public.news_items for select to anon, authenticated using (true);
revoke all on public.news_items from anon, authenticated;
grant select on public.news_items to anon, authenticated;

-- ==== 8. 对话纪要的向量（语义检索；向量由浏览器用 bge-m3 算好后写入） ====
create extension if not exists vector;
create table if not exists public.digest_vecs (
  user_id    varchar(64) not null default auth.uid(),
  id         text        not null check (id ~ '^g[0-9a-z]{6,24}$'),
  embedding  vector(1024) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.digest_vecs enable row level security;
drop policy if exists dv_own on public.digest_vecs;
create policy dv_own on public.digest_vecs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.digest_vecs from anon;
grant select, insert, update, delete on public.digest_vecs to authenticated;
-- 按意思找最相近的几份纪要（只在自己的数据里找）
create or replace function public.match_digests(q vector(1024), n int default 5)
returns table (id text, score float) language sql stable as $$
  select id, 1 - (embedding <=> q) as score from public.digest_vecs
  where user_id = auth.uid() order by embedding <=> q limit least(greatest(n, 1), 20);
$$;
grant execute on function public.match_digests(vector, int) to authenticated;
