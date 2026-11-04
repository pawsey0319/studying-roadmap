#!/usr/bin/env python3
"""财经快讯与热榜：财联社电报、华尔街见闻快讯、金十快讯、雪球热股。写 data/hot.json；
配置了 CLOUDBASE_ENV + CLOUDBASE_API_KEY 时同时写进云端的 hot_items 表（App 打开时直接读，不用等网站重新部署）。

只存标题、原文链接、时间，不存正文。抓取方式参考 newsnow（MIT）对这几个站点公开接口的调用方式，代码是自己写的，
没有复制 newsnow 或 RSSHub 的代码。只用标准库。用法：python3 tools/fetch_hot.py
"""
import hashlib
import html
import http.cookiejar
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "hot.json"
CST = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
KEEP = 60  # 每个来源最多保留几条


def get(url, headers=None, opener=None, timeout=20):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)) as r:
        return r.read().decode("utf-8", "replace")


def clean(s, n=140):
    s = html.unescape(re.sub(r"<[^>]+>", "", str(s or ""))).replace("\n", " ").strip()
    return s[:n]


def ts(sec):
    return datetime.fromtimestamp(int(sec), CST).strftime("%Y-%m-%d %H:%M")


def cls():
    """财联社电报。接口要求按参数排序后的查询串计算 sign = md5(sha1(查询串))。"""
    p = sorted({"appName": "CailianpressWeb", "os": "web", "sv": "7.7.5"}.items())
    q = urllib.parse.urlencode(p)
    sign = hashlib.md5(hashlib.sha1(q.encode()).hexdigest().encode()).hexdigest()
    data = json.loads(get(f"https://www.cls.cn/v1/roll/get_roll_list?{q}&sign={sign}", {"Referer": "https://www.cls.cn/telegraph"}))
    out = []
    for x in (data.get("data") or {}).get("roll_data") or []:
        if x.get("is_ad"):
            continue
        t = clean(x.get("title") or re.sub(r"^【[^】]*】", "", x.get("content") or "") or x.get("brief"))
        m = re.match(r"^【([^】]+)】", x.get("content") or "")
        if m and not x.get("title"):
            t = clean(m.group(1))
        if not t:
            continue
        out.append({"t": t, "u": x.get("shareurl") or f"https://www.cls.cn/detail/{x.get('id')}", "time": ts(x.get("ctime") or 0), "lvl": x.get("level") or ""})
    return out


def wallstreet():
    data = json.loads(get("https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=40"))
    out = []
    for x in (data.get("data") or {}).get("items") or []:
        t = clean(x.get("title") or x.get("content_text"))
        if t:
            out.append({"t": t, "u": x.get("uri") or f"https://wallstreetcn.com/live/{x.get('id')}", "time": ts(x.get("display_time") or 0)})
    return out


def jin10():
    raw = get("https://www.jin10.com/flash_newest.js")
    raw = re.sub(r"^\s*var\s+newest\s*=\s*", "", raw).rstrip().rstrip(";")
    out = []
    for x in json.loads(raw):
        if 5 in (x.get("channel") or []):  # 广告和推广频道
            continue
        d = x.get("data") or {}
        c = clean(d.get("title") or d.get("content"), 400)
        m = re.match(r"^【([^】]+)】(.*)$", c)
        t = clean(m.group(1) if m else c)
        if not t or d.get("vip_title"):
            continue
        out.append({"t": t, "u": f"https://flash.jin10.com/detail/{x.get('id')}", "time": (x.get("time") or "")[:16]})
    return out


def xueqiu():
    """雪球热股：先访问一次行情页拿到 Cookie。"""
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    get("https://xueqiu.com/hq", opener=op)
    data = json.loads(get("https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=30&_type=10&type=10", opener=op))
    out = []
    for x in (data.get("data") or {}).get("items") or []:
        if x.get("ad"):
            continue
        pct = x.get("percent")
        out.append({"t": f"{x.get('name')} {'+' if (pct or 0) > 0 else ''}{pct}%", "u": f"https://xueqiu.com/S/{x.get('symbol') or x.get('code')}",
                    "time": datetime.now(CST).strftime("%Y-%m-%d %H:%M"), "extra": {"price": x.get("current"), "code": x.get("code")}})
    return out


SOURCES = [("cls", "财联社电报", cls), ("wallstreet", "华尔街见闻快讯", wallstreet), ("jin10", "金十快讯", jin10), ("xueqiu", "雪球热股", xueqiu)]


def push_cloud(rows):
    """写进 CloudBase 的 hot_items 表（需要 secret 级别的 API Key，只放在 GitHub Secrets 或本机环境变量里）。"""
    env, key = os.environ.get("CLOUDBASE_ENV", "").strip(), os.environ.get("CLOUDBASE_API_KEY", "").strip()
    if not env or not key:
        return "没有配置 CLOUDBASE_ENV / CLOUDBASE_API_KEY，只写本地文件"
    base = f"https://{env}.api.tcloudbasegateway.com/v1/rdb/rest"
    body = json.dumps(rows).encode()
    req = urllib.request.Request(base + "/hot_items?on_conflict=id", data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    urllib.request.urlopen(req, timeout=30).read()
    # 只保留最近 3 天
    cut = (datetime.now(CST) - timedelta(days=3)).isoformat()
    req = urllib.request.Request(base + "/hot_items?fetched_at=lt." + urllib.parse.quote(cut), method="DELETE", headers={"Authorization": "Bearer " + key})
    urllib.request.urlopen(req, timeout=30).read()
    return f"已写入云端 {len(rows)} 条"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    now = datetime.now(CST)
    data, report, rows = {"updated": now.strftime("%Y-%m-%d %H:%M"), "sources": []}, [], []
    for sid, name, fn in SOURCES:
        try:
            its = fn()[:KEEP]
            report.append(f"成功 {name}: {len(its)} 条")
        except Exception as e:
            its = []
            report.append(f"失败 {name}: {type(e).__name__}: {e}")
        data["sources"].append({"id": sid, "name": name, "items": its})
        for i, x in enumerate(its):
            rows.append({"id": f"{sid}:{hashlib.md5(x['u'].encode()).hexdigest()[:16]}", "source": sid, "title": x["t"], "url": x["u"],
                         "time": x.get("time") or "", "rank": i, "fetched_at": now.isoformat()})
    data["status"] = report
    if any(s["items"] for s in data["sources"]):
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    try:
        report.append(push_cloud(rows))
    except Exception as e:
        report.append(f"写云端失败：{type(e).__name__}: {e}")
    print("\n".join(report))


if __name__ == "__main__":
    main()
