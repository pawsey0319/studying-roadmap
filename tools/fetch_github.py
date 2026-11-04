#!/usr/bin/env python3
"""关键项目新版本和近 30 天新星项目：在 GitHub Actions 里用自带的令牌抓（每小时 5000 次，网页匿名只有 60 次）。
写 data/github.json；配置了 CLOUDBASE_ENV + CLOUDBASE_API_KEY 时同时写进云端的 live_cache 表，网页打开直接读，不用等部署。
令牌读 GITHUB_TOKEN（Actions 自动提供，不需要自己建）。只用标准库。用法：python3 tools/fetch_github.py
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "github.json"
CST = timezone(timedelta(hours=8))
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()


def gh(path):
    h = {"Accept": "application/vnd.github+json", "User-Agent": "learning-hub", "X-GitHub-Api-Version": "2022-11-28"}
    if TOKEN:
        h["Authorization"] = "Bearer " + TOKEN
    with urllib.request.urlopen(urllib.request.Request("https://api.github.com" + path, headers=h), timeout=20) as r:
        return json.loads(r.read())


PRE = re.compile(r"rc\d|[-.]?(alpha|beta|dev|nightly|preview)\b", re.I)


def from_atom(r):
    """每个仓库公开的 releases.atom 不占 API 次数，接口用完或没有令牌时用它。"""
    with urllib.request.urlopen(urllib.request.Request(f"https://github.com/{r}/releases.atom", headers={"User-Agent": "learning-hub"}), timeout=20) as f:
        root = ET.fromstring(f.read())
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for e in root.findall("a:entry", ns):
        tag = (e.findtext("a:id", "", ns) or "").rsplit("/", 1)[-1]
        if not tag or PRE.search(tag):
            continue
        link = e.find("a:link", ns)
        return {"t": f"{r.split('/')[1]} {tag}", "u": link.get("href") if link is not None else f"https://github.com/{r}/releases", "r": r, "at": e.findtext("a:updated", "", ns)}
    return None


def releases(repos):
    out, fail = [], []
    for r in repos:
        x = None
        try:
            rel = [y for y in gh(f"/repos/{r}/releases?per_page=5") if not y.get("prerelease") and not y.get("draft")]
            if rel:
                x = {"t": f"{r.split('/')[1]} {rel[0]['tag_name']}", "u": rel[0]["html_url"], "r": r, "at": rel[0].get("published_at") or ""}
        except Exception:
            try:
                x = from_atom(r)
            except Exception as e:
                fail.append(f"{r}: {type(e).__name__}")
                continue
        if x:
            out.append(x)
    out.sort(key=lambda x: x["at"], reverse=True)
    return out[:7], fail


def stars(topic):
    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    q = urllib.parse.quote(f"topic:{topic} created:>{since}")
    d = gh(f"/search/repositories?sort=stars&order=desc&per_page=6&q={q}")
    return [{"t": x["full_name"], "u": x["html_url"], "stars": x["stargazers_count"], "desc": (x.get("description") or "")[:120]} for x in d.get("items", [])]


def push_cloud(data):
    env, key = os.environ.get("CLOUDBASE_ENV", "").strip(), os.environ.get("CLOUDBASE_API_KEY", "").strip()
    if not env or not key:
        return "没有配置 CLOUDBASE_ENV / CLOUDBASE_API_KEY，只写本地文件"
    body = json.dumps([{"k": "github", "data": data, "updated_at": datetime.now(CST).isoformat()}]).encode()
    req = urllib.request.Request(f"https://{env}.api.tcloudbasegateway.com/v1/rdb/rest/live_cache?on_conflict=k", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    urllib.request.urlopen(req, timeout=30).read()
    return "已写入云端 live_cache"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    cfg = json.loads((ROOT / "content" / "github.json").read_text(encoding="utf-8"))
    topics = {}
    for p in sorted((ROOT / "content" / "tracks").glob("*.json")):
        t = json.loads(p.read_text(encoding="utf-8"))
        if (t.get("live") or {}).get("gh"):
            topics[t["id"]] = t["live"]["gh"]
    data, report = {"updated": datetime.now(CST).strftime("%Y-%m-%d %H:%M"), "rel": {}, "gh": {}}, []
    for tid, repos in cfg["repos"].items():
        data["rel"][tid], fail = releases(repos)
        report.append(f"{tid} 新版本 {len(data['rel'][tid])} 条" + (f"，失败 {', '.join(fail)}" if fail else ""))
    for tid, topic in topics.items():
        try:
            data["gh"][tid] = stars(topic)
            report.append(f"{tid} 新星项目 {len(data['gh'][tid])} 个")
        except Exception as e:
            report.append(f"{tid} 新星项目失败：{type(e).__name__}: {e}")
    if any(data["rel"].values()) or any(data["gh"].values()):
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    try:
        report.append(push_cloud(data))
    except Exception as e:
        report.append(f"写云端失败：{type(e).__name__}: {e}")
    print(("已用令牌" if TOKEN else "没有令牌（匿名，每小时 60 次）") + "\n" + "\n".join(report))


if __name__ == "__main__":
    main()
