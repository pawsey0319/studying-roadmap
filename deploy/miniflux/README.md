# 在腾讯云开发「云托管」上部署 Miniflux（国内 RSS 抓取）

Miniflux 负责每小时抓国内 RSS（公众号、国内博客）。GitHub Actions 每 2 小时从它拉条目、写进 `news_items` 表，并把海外源推给它统一去重。
**不部署也能用**：没有 Miniflux 时，资讯照旧来自 GitHub Actions 的每日快照。

## 1. 建一个独立的数据库账号和 schema（SQL 编辑器，管理员角色）

```sql
create schema if not exists miniflux;
create role miniflux_app login password '在这里填一个强密码';
grant usage, create on schema miniflux to miniflux_app;
alter role miniflux_app set search_path = miniflux;
```

Miniflux 的表名（users、feeds、entries）和业务表不冲突，因为它们都建在 `miniflux` schema 里；前端的 REST 接口只开放 public，读不到这些表。

## 2. 云托管新建服务

- 部署方式：**镜像拉取**，镜像填 `docker.io/miniflux/miniflux:latest`（拉不到时用 `ghcr.io/miniflux/miniflux:latest`）
- 端口：`8080`
- 规格：0.25 核 / 0.5 GB；**最小实例数 1**（它在容器内部定时抓取，缩到 0 就不抓了）
- 环境变量：

| 变量 | 值 |
|---|---|
| `DATABASE_URL` | `postgres://miniflux_app:上面的密码@数据库内网地址:5432/数据库名?sslmode=disable`（地址在“数据库 → 连接信息”里） |
| `DATABASE_MAX_CONNS` | `5` |
| `RUN_MIGRATIONS` | `1` |
| `CREATE_ADMIN` | `1` |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | 在这里填一个强密码 |
| `POLLING_FREQUENCY` | `60` |
| `BASE_URL` | 云托管分配的访问地址 |

## 3. 导入订阅并拿 API Token

1. 打开云托管分配的地址，用 admin 登录。
2. 设置 → 导入 → 上传本目录的 `feeds-cn.opml`（国内源）。
3. 分类名就是方向 ID：`llm`、`slm`、`agent`、`quant`，可以多个用逗号分隔，如 `llm,agent`。订阅名里带 `[A]` 表示一手来源，`[C]` 表示社区，默认 `[B]`。
4. 设置 → API 密钥 → 新建，复制 Token。
5. GitHub 仓库 Secrets 新建 `MINIFLUX_URL`（云托管地址）和 `MINIFLUX_TOKEN`。

费用：0.25 核常驻约 14 元/月，从个人版套餐额度里扣。
