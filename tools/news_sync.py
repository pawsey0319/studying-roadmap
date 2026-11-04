#!/usr/bin/env python3
"""把资讯同步进云端（CloudBase 的 news_items 表），App 打开就能读到最新资讯，不用等网站重新部署。

两种来源，按配置自动选：
  1. Miniflux（部署在 CloudBase 云托管，抓国内 RSS）：配置 MINIFLUX_URL + MINIFLUX_TOKEN 时，从它的 API 拉最近 2 天的条目；
     同时可以把 GitHub Actions 抓到的海外条目推给 Miniflux（--push-overseas），由它统一去重。
  2. 没有 Miniflux：直接读 data/sources.json（每天的快照）写进 news_items。
写云端需要 CLOUDBASE_ENV + CLOUDBASE_API_KEY（secret 级别的 API Key，只放在 GitHub Secrets 或本机环境变量）。
只用标准库。用法：python3 tools/news_sync.py [--push-overseas]
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from weekly import news_id  # noqa: E402  和网页里的资讯 ID 算法一致

ROOT = Path(__file__).resolve().parent.parent
CST = timezone(timedelta(hours=8))
env = lambda k: os.environ.get(k, "").strip()


def req(url, method="GET", body=None, headers=None, timeout=30):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


# ---------- Miniflux ----------
def mf(path, method="GET", body=None):
    return req(env("MINIFLUX_URL").rstrip("/") + "/v1" + path, method, body, {"X-Auth-Token": env("MINIFLUX_TOKEN")})


def from_miniflux():
    after = int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp())
    feeds = {f["id"]: f for f in mf("/feeds")}
    out, offset = [], 0
    while True:
        page = mf(f"/entries?after={after}&limit=200&offset={offset}&order=published_at&direction=desc")
        for e in page.get("entries", []):
            f = feeds.get(e["feed_id"], {})
            cat = (f.get("category") or {}).get("title", "")      # 分类名约定：方向 ID，用逗号分隔，例如 "llm,agent"
            lvl = "A" if "[A]" in f.get("title", "") else "C" if "[C]" in f.get("title", "") else "B"
            out.append({"d": e["published_at"][:10], "src": f.get("title", "").replace("[A]", "").replace("[B]", "").replace("[C]", "").strip(),
                        "lvl": lvl, "k": [k for k in cat.split(",") if k], "t": e["title"][:160], "u": e["url"]})
        offset += 200
        if offset >= page.get("total", 0) or offset > 2000:
            break
    return out


def push_overseas():
    """把 data/sources.json 里的海外源条目推进 Miniflux 同名的停用订阅（Miniflux ≥ 2.2.19 的导入接口，按 external_id 去重）。"""
    snap = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8")).get("items", [])
    feeds = {f["title"]: f["id"] for f in mf("/feeds")}
    n = 0
    for x in snap:
        fid = feeds.get(x["src"])
        if not fid:
            continue
        try:
            mf(f"/feeds/{fid}/entries/import", "POST", {"url": x["u"], "title": x["t"], "external_id": news_id(x["u"]),
                                                       "published_at": int(datetime.strptime(x["d"], "%Y-%m-%d").replace(tzinfo=CST).timestamp())})
            n += 1
        except Exception:
            pass
    return n


def from_snapshot():
    p = ROOT / "data" / "sources.json"
    cut = (datetime.now(CST) - timedelta(days=3)).strftime("%Y-%m-%d")
    items = json.loads(p.read_text(encoding="utf-8")).get("items", []) if p.exists() else []
    return [x for x in items if x.get("d", "") >= cut]


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    if env("MINIFLUX_URL") and env("MINIFLUX_TOKEN"):
        if "--push-overseas" in sys.argv:
            print(f"推给 Miniflux 的海外条目：{push_overseas()} 条")
        items, src = from_miniflux(), "Miniflux"
    else:
        items, src = from_snapshot(), "每日快照"
    rows, seen = [], set()
    for x in items:
        nid = news_id(x["u"])
        if nid in seen or not x["u"].startswith("http"):
            continue
        seen.add(nid)
        rows.append({"id": nid, "d": x["d"], "src": x.get("src", "")[:80], "lvl": x.get("lvl") if x.get("lvl") in ("A", "B", "C") else "B",
                     "k": x.get("k") or [], "t": x["t"][:160], "s": (x.get("s") or "")[:200], "u": x["u"], "via": x.get("via"),
                     "fetched_at": datetime.now(CST).isoformat()})
    print(f"从{src}读到 {len(rows)} 条")
    e, key = env("CLOUDBASE_ENV"), env("CLOUDBASE_API_KEY")
    if not e or not key:
        print("没有配置 CLOUDBASE_ENV / CLOUDBASE_API_KEY，跳过写云端")
        return
    base, h = f"https://{e}.api.tcloudbasegateway.com/v1/rdb/rest", {"Authorization": "Bearer " + key}
    for i in range(0, len(rows), 200):
        req(base + "/news_items?on_conflict=id", "POST", rows[i:i + 200], {**h, "Prefer": "resolution=merge-duplicates,return=minimal"})
    cut = (datetime.now(CST) - timedelta(days=45)).strftime("%Y-%m-%d")
    req(base + "/news_items?d=lt." + cut, "DELETE", None, h)
    print(f"已写入云端 news_items：{len(rows)} 条")


if __name__ == "__main__":
    main()
