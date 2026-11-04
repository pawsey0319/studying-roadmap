#!/usr/bin/env python3
"""把每日快照（data/sources.json）里最近 3 天的资讯写进云端（CloudBase 的 news_items 表），App 打开就能读到，不用等网站重新部署。
写云端需要 CLOUDBASE_ENV + CLOUDBASE_API_KEY（服务端 API Key，只放在 GitHub Secrets 或本机环境变量）。
只用标准库。用法：python3 tools/news_sync.py
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
