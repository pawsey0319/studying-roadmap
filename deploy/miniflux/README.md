# 在腾讯云开发「云托管」上部署 Miniflux（国内 RSS 抓取）

Miniflux 常驻在云托管里，每小时抓一次国内源（公众号、国内科技媒体），条目存在同一个数据库的 `miniflux` 区里。
数据库函数 `sync_miniflux` 把这些条目整理进 `news_items`，网站和 App 打开就能读到。GitHub Actions 每 2 小时调一次这个函数。

这样 Miniflux **不需要 API Token，导入订阅后也可以关掉公网访问**。不部署也能用，资讯照旧来自 GitHub Actions 的每日快照。

这套配置在本地用 PostgreSQL 14 + Miniflux 2.3.5 跑通过：建账号、建表、导入 24 个订阅、抓取、同步进 `news_items`。

## 0. 先准备两个密码

终端运行两次，各得到一个随机密码，先记在密码管理器里：

```bash
openssl rand -hex 16
```

- 密码 1：数据库账号 `miniflux_app` 用
- 密码 2：Miniflux 网页登录（admin）用

## 1. 建数据库账号（SQL 编辑器）

控制台 → 数据库 → PostgreSQL → SQL 编辑器，把 `密码1` 换掉后执行：

```sql
create schema if not exists miniflux;
create role miniflux_app login password '密码1';
grant usage, create on schema miniflux to miniflux_app;
alter role miniflux_app set search_path = miniflux;
```

这个账号只能在 `miniflux` 区里建表和读写，碰不到 `docs`、`public_items` 这些业务表。

## 2. 找到数据库的连接地址

控制台 → 数据库 → PostgreSQL，找“连接信息”或“直连”（名字可能略有不同），记下：**内网地址**、**端口**、**数据库名**。
有“直连”和“连接池”两种地址时，用**直连**（Miniflux 是常驻服务，只开少量连接）。

## 3. 云托管新建服务

控制台 → 云托管 → 新建服务 → **从容器镜像部署**（或“镜像拉取”）。

| 项 | 填什么 |
|---|---|
| 镜像地址 | `miniflux/miniflux:2.3.5`（Docker Hub 拉不到时用 `ghcr.io/miniflux/miniflux:2.3.5`） |
| 服务名称 | `miniflux` |
| 端口 | `8080` |
| 规格 | 0.25 核 / 0.5 GiB |
| 最小实例数 | **1**（它在容器里定时抓取，缩到 0 就不抓了） |
| 最大实例数 | **1**（多个实例会重复抓） |
| 公网访问 | 先打开，导入订阅后可以关掉 |

环境变量（选 JSON 方式，替换三处后整段粘进去）：

```json
{
  "DATABASE_URL": "postgres://miniflux_app:密码1@内网地址:端口/数据库名?sslmode=disable&search_path=miniflux",
  "DATABASE_MAX_CONNS": "3",
  "RUN_MIGRATIONS": "1",
  "CREATE_ADMIN": "1",
  "ADMIN_USERNAME": "admin",
  "ADMIN_PASSWORD": "密码2",
  "POLLING_FREQUENCY": "60",
  "BATCH_SIZE": "30",
  "LISTEN_ADDR": "0.0.0.0:8080"
}
```

部署日志里出现 `Starting HTTP server` 就是起来了。

常见报错：
- 日志里有 `no encryption` 或其他 SSL 相关的报错：把 `sslmode=disable` 改成 `sslmode=require`。
- `password authentication failed`：密码 1 和第 1 步不一致。
- `permission denied for schema miniflux`：第 1 步的 `grant` 没执行。

## 4. 导入订阅

1. 打开云托管分配的默认域名，用 `admin` / 密码 2 登录。
2. 设置（Settings）→ 导入（Import）→ 上传本目录的 `feeds-cn.opml`，导入 24 个国内源。
3. 等一两分钟，“订阅”页里各源出现条目。个别源显示错误不要紧，单个源失败不影响其他源。

分类名规则：`llm`、`slm` 这类方向 ID 原样归类；分类 `auto` 里的综合媒体（36氪、机器之心等）按关键词判断方向，和 AI 无关的条目不进网站。订阅名带 `[A]` 是一手来源，`[C]` 是社区，默认 `[B]`。以后自己加订阅，按这个规则放分类、改名字就行。

导入完可以把这个服务的**公网访问关掉**：同步走数据库，不经过 Miniflux 的网页。以后想加订阅时再临时打开。

## 5. 接到网站（SQL 编辑器）

执行 `cloudbase/schema.sql` 的**第 10 段**（从 `-- ==== 10.` 开始到文件末尾）。最后一行会返回“同步了多少条”，大于 0 就通了。

之后不用再管：GitHub Actions 的“资讯与快讯同步到云端”每 2 小时会调用一次 `sync_miniflux`。想更及时，可以执行第 10 段末尾注释掉的那条 `cron.schedule`（每 30 分钟，在数据库里跑）。

如果第 10 段第一句 `grant miniflux_app to current_user` 报权限错误，把报错截图发我，换一种授权写法。

## 费用

0.25 核 0.5 GiB 常驻一个月约 13 万 CU（约 ¥14.4）。个人版套餐每月含 15 万 CU，云函数和云托管共用；超出的部分按量计费，所以要在环境里开着“超限按量”，否则云托管会被停掉。
