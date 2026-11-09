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

-- ==== 7. 资讯条目（tools/news_sync.py 从每日快照写入，所有人可读） ====
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

-- ==== 9. 公共区域：最近 30 天的采用次数（只返回计数，不暴露是谁采用的） ====
create or replace function public.public_recent(days int default 30)
returns table (item_id bigint, n bigint) language sql stable security definer set search_path = public as $$
  select a.item_id, count(*) from adoptions a join public_items p on p.id = a.item_id
  where p.status = 'published' and a.created_at > now() - make_interval(days => least(greatest(days, 1), 90))
  group by a.item_id;
$$;
revoke all on function public.public_recent(int) from public, anon;
grant execute on function public.public_recent(int) to authenticated;

-- ==== 10. 预取的实时数据（tools/fetch_github.py 每 2 小时写入：关键项目新版本、新星项目；所有人可读） ====
create table if not exists public.live_cache (
  k          text        primary key check (k ~ '^[a-z0-9_-]{2,30}$'),
  data       jsonb       not null check (pg_column_size(data) < 512 * 1024),
  updated_at timestamptz not null default now()
);
alter table public.live_cache enable row level security;
drop policy if exists lc_read on public.live_cache;
create policy lc_read on public.live_cache for select to anon, authenticated using (true);
revoke all on public.live_cache from anon, authenticated;
grant select on public.live_cache to anon, authenticated;

-- ==== 11. 平台模型：额度、用量和订阅预留（第一版；只给云函数 lh-ai 调用，网页和普通用户都不能直接读写） ====
-- 前提：在下面第一行把 <调用口令> 换成一串 32 位以上的随机字符，和云函数环境变量 AI_DB_SECRET 填同一串。不要提交到仓库。
create table if not exists public.ai_secret (id int primary key default 1 check (id = 1), secret text not null check (char_length(secret) >= 32));
-- insert into public.ai_secret (id, secret) values (1, '<调用口令>') on conflict (id) do update set secret = excluded.secret;
alter table public.ai_secret enable row level security;
revoke all on public.ai_secret from anon, authenticated;

-- 每人每天每个功能一行
create table if not exists public.ai_usage (
  user_id    varchar(64) not null,
  day        date        not null default (now() at time zone 'Asia/Shanghai')::date,
  feat       text        not null default 'other' check (feat ~ '^[a-z]{2,12}$'),
  calls      int         not null default 0,
  tin        bigint      not null default 0,
  tout       bigint      not null default 0,
  cost_micro bigint      not null default 0,
  primary key (user_id, day, feat)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- 订阅预留：第一版不接支付，由管理员手动插入；plan = 'sub' 且 until 未到期时按订阅额度算
create table if not exists public.ai_entitlements (
  user_id     varchar(64) primary key,
  plan        text        not null default 'free' check (plan in ('free', 'sub')),
  day_limit   int         check (day_limit is null or day_limit between 0 and 100000),
  month_limit int         check (month_limit is null or month_limit between 0 and 3000000),
  until       timestamptz,
  note        text        not null default '' check (char_length(note) <= 200),
  updated_at  timestamptz not null default now()
);
alter table public.ai_entitlements enable row level security;
revoke all on public.ai_entitlements from anon, authenticated;

create or replace function public.ai_ok(p_secret text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ai_secret where id = 1 and secret = p_secret);
$$;

-- 记一次调用；超过上限返回 ok = false 且不计数。自动总结和翻译（summary、translate）单独限每天 p_light 次，不占主额度
create or replace function public.ai_take(p_secret text, p_user varchar, p_feat text, p_day int, p_month int, p_light int)
returns json language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; c_day int; c_month int; c_light int; light boolean := p_feat in ('summary', 'translate');
begin
  if not ai_ok(p_secret) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext('ai_take:' || p_user));
  select coalesce(sum(calls) filter (where day = d and feat not in ('summary', 'translate')), 0),
         coalesce(sum(calls) filter (where feat not in ('summary', 'translate')), 0),
         coalesce(sum(calls) filter (where day = d and feat in ('summary', 'translate')), 0)
    into c_day, c_month, c_light
    from ai_usage where user_id = p_user and day >= date_trunc('month', d)::date;
  if (light and c_light >= p_light) or (not light and (c_day >= p_day or c_month >= p_month)) then
    return json_build_object('ok', false, 'day', c_day, 'month', c_month, 'light', c_light);
  end if;
  insert into ai_usage (user_id, day, feat, calls) values (p_user, d, p_feat, 1)
    on conflict (user_id, day, feat) do update set calls = ai_usage.calls + 1;
  return json_build_object('ok', true, 'day', c_day + (case when light then 0 else 1 end), 'month', c_month + (case when light then 0 else 1 end), 'light', c_light + (case when light then 1 else 0 end));
end $$;

-- 调用结束后补记 token 和成本；p_refund = true 表示上游失败，把刚才记的那一次退回
create or replace function public.ai_record(p_secret text, p_user varchar, p_feat text, p_in bigint, p_out bigint, p_cost bigint, p_refund boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; target date := d;
begin
  if not ai_ok(p_secret) then raise exception 'forbidden'; end if;
  -- 退款可能跨北京时间零点才执行：退最近一条还没退完的记录，否则会找不到昨天的行、这次调用一直占着额度
  if p_refund then
    select max(day) into target from ai_usage
      where user_id = p_user and feat = p_feat and calls > 0 and day >= date_trunc('month', d)::date;
    target := coalesce(target, d);
  end if;
  update ai_usage set tin = tin + greatest(p_in, 0), tout = tout + greatest(p_out, 0), cost_micro = cost_micro + greatest(p_cost, 0),
    calls = case when p_refund then greatest(calls - 1, 0) else calls end
  where user_id = p_user and day = target and feat = p_feat;
end $$;

create or replace function public.ai_peek(p_secret text, p_user varchar)
returns json language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; r json;
begin
  if not ai_ok(p_secret) then raise exception 'forbidden'; end if;
  select json_build_object(
    'day', coalesce(sum(calls) filter (where day = d and feat not in ('summary', 'translate')), 0),
    'month', coalesce(sum(calls) filter (where feat not in ('summary', 'translate')), 0),
    'light', coalesce(sum(calls) filter (where day = d and feat in ('summary', 'translate')), 0))
  into r from ai_usage where user_id = p_user and day >= date_trunc('month', d)::date;
  return r;
end $$;

-- 这个用户的套餐记录；没有记录返回 null
create or replace function public.ai_plan(p_secret text, p_user varchar)
returns json language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not ai_ok(p_secret) then raise exception 'forbidden'; end if;
  select json_build_object('plan', plan, 'day_limit', day_limit, 'month_limit', month_limit, 'until', until) into r from ai_entitlements where user_id = p_user;
  return r;
end $$;

revoke execute on function public.ai_ok(text) from public, anon, authenticated;
revoke execute on function public.ai_take(text, varchar, text, int, int, int) from public, anon;
revoke execute on function public.ai_record(text, varchar, text, bigint, bigint, bigint, boolean) from public, anon;
revoke execute on function public.ai_peek(text, varchar) from public, anon;
revoke execute on function public.ai_plan(text, varchar) from public, anon;
-- 服务端 API Key 以什么数据库角色执行不确定，所以四个函数对 authenticated 保留执行权限，由调用口令把关：
-- 普通用户能调到函数，但不知道口令，函数第一行就拒绝。
grant execute on function public.ai_take(text, varchar, text, int, int, int) to authenticated;
grant execute on function public.ai_record(text, varchar, text, bigint, bigint, bigint, boolean) to authenticated;
grant execute on function public.ai_peek(text, varchar) to authenticated;
grant execute on function public.ai_plan(text, varchar) to authenticated;

-- 管理员看用量（元）：select day, feat, sum(calls) calls, sum(tin) tin, sum(tout) tout, round(sum(cost_micro) / 1e6, 2) cny from ai_usage group by 1, 2 order by 1 desc, 2;
-- 每人每月成本：select user_id, round(sum(cost_micro) / 1e6, 2) cny, sum(calls) calls from ai_usage where day >= date_trunc('month', now()) group by 1 order by 2 desc limit 50;
-- 给某人开订阅额度（第一版没有支付，手动开 30 天）：
--   insert into ai_entitlements (user_id, plan, until, note) values ('<用户 ID>', 'sub', now() + interval '30 days', '手动开通')
--   on conflict (user_id) do update set plan = excluded.plan, until = excluded.until, note = excluded.note, updated_at = now();
-- 邀请制（云函数 AI_INVITE_ONLY=1）时，给某人开免费额度：insert into ai_entitlements (user_id, plan, note) values ('<用户 ID>', 'free', '邀请') on conflict (user_id) do nothing;
