#!/usr/bin/env python3
"""每周一的云端任务（GitHub Actions 运行，也可以在任何电脑上手动跑）。

做的事：
  1. 抓社区讨论（Reddit、Hacker News），写 data/community.json；Reddit 被拦截时沿用上周的 Reddit 部分。
  2. 从一周的快照（data/sources.json，先运行 fetch_sources.py 生成）里挑精选候选：只看 A/B 级、近 8 天、精选里还没有的。
  3. 程序核验：逐条打开原文，打不开（404/域名失效）的丢掉；能读到发布日期且明显是旧文的丢掉。
  4. 免费模型整理：挑出值得收的、写中文标题和一句说明、判断方向和前沿路线。写进 content/feed.json，标 "ai": true。
  5. 前沿路线精修：给已有路线补关键词、合并重复路线、从没归类的资讯里拆出新路线（写进 content/routes.json）。
  6. 对理论路线的修改只写成“待确认建议”（content/suggestions.json），用户在网站上点“应用”才生效。

来源等级由程序按来源白名单决定，不让模型决定。模型接口按顺序轮换，一个失败就换下一个：
  MODELSCOPE_KEY（魔搭，首选）→ SILICONFLOW_KEY（硅基流动免费模型）→ ZHIPU_KEY（智谱免费模型）→ LLM_BASE/LLM_KEY/LLM_MODEL（自定义）
可选：SUPABASE_URL + SUPABASE_SERVICE_KEY，读取内测用户对 AI 整理结果的“分错了”标记（只读 marks 这一份数据，只做汇总）。

用法：python3 tools/weekly.py [--stage all|collect|ai|auto] [--dry-run] [--skip-community] [--force]
只用标准库。
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_sources as FS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CST = timezone(timedelta(hours=8))
TODAY = datetime.now(CST).date()
P = {
    "feed": ROOT / "content" / "feed.json",
    "routes": ROOT / "content" / "routes.json",
    "sugs": ROOT / "content" / "suggestions.json",
    "domains": ROOT / "content" / "domains.json",
    "sources": ROOT / "data" / "sources.json",
    "community": ROOT / "data" / "community.json",
}
TYPES = ("news", "paper", "dir", "biz")
PER_TRACK_NEW = 6       # 每个方向每周最多新增几条精选
PER_TRACK_KEEP = 45     # 每个方向最多保留几条精选
CAND_PER_TRACK = 24     # 每个方向最多送多少候选给模型
REPORT = []


def log(msg):
    REPORT.append(msg)
    print(msg, flush=True)


def load(p, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def dump(p, data, compact=False):
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(data, ensure_ascii=False, indent=1)
    p.write_text(text + "\n", encoding="utf-8")


# ---------- 资讯 ID：和网页 src/core/ids.js 的 newsId 算法一致，用来对上用户的标记 ----------
def norm_url(u):
    try:
        x = urllib.parse.urlsplit(u.strip())
        if not x.scheme or not x.netloc:
            raise ValueError
        drop = {"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"}
        q = [(k, v) for k, v in urllib.parse.parse_qsl(x.query, keep_blank_values=True) if k not in drop]
        search = ("?" + urllib.parse.urlencode(q, safe="*").replace("~", "%7E")) if q else ""
        host = (x.hostname or "") + (f":{x.port}" if x.port else "")
        host = host[4:] if host.startswith("www.") else host
        path = urllib.parse.quote(x.path, safe="/%:@!$&'()*+,;=-._~").rstrip("/")
        return (host + path + search).lower()
    except (ValueError, AttributeError):
        return str(u or "").strip().lower()


def fnv_hash(s):
    h1, h2 = 0x811C9DC5, 0x01000193 ^ 0x5BD1E995
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        c = b[i] | (b[i + 1] << 8)
        h1 = ((h1 ^ c) * 0x01000193) & 0xFFFFFFFF
        h2 = ((h2 ^ c) * 0x5BD1E995) & 0xFFFFFFFF
    return (f"{h1:08x}{h2:08x}")[:12]


def news_id(u):
    return "n" + fnv_hash(norm_url(u))


# ---------- 免费模型轮换 ----------
def providers():
    env = os.environ.get
    out = []
    if env("MODELSCOPE_KEY"):
        for m in (env("MODELSCOPE_MODEL") or "deepseek-ai/DeepSeek-V4.1-Flash,ZhipuAI/GLM-5.3").split(","):
            out.append(("魔搭 " + m.strip(), "https://api-inference.modelscope.cn/v1", env("MODELSCOPE_KEY"), m.strip()))
    if env("SILICONFLOW_KEY"):
        out.append(("硅基流动", "https://api.siliconflow.cn/v1", env("SILICONFLOW_KEY"), env("SILICONFLOW_MODEL") or "Qwen/Qwen3-8B"))
    if env("ZHIPU_KEY"):
        out.append(("智谱", "https://open.bigmodel.cn/api/paas/v4", env("ZHIPU_KEY"), env("ZHIPU_MODEL") or "glm-4-flash"))
    if env("LLM_BASE") and env("LLM_KEY") and env("LLM_MODEL"):
        # 聚合接口一个 Key 能调多个模型：LLM_MODEL 可以写多个，用逗号分隔，前一个失败就换下一个
        base = clean_base(env("LLM_BASE"))
        for m in env("LLM_MODEL").split(","):
            if m.strip():
                out.append(("自定义 " + m.strip(), base, env("LLM_KEY").strip(), m.strip()))
    return out


def clean_base(u):
    """容错：去掉首尾空白、引号、结尾的 /chat/completions；没写 https:// 的补上。"""
    u = str(u or "").strip().strip("'\"").strip()
    if u and not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return re.sub(r"/chat/completions/?$", "", u).rstrip("/")


def check_base(name, base):
    """调用前先确认地址能连上。日志是公开的，所以不打印地址本身，只说明问题在哪。
    内网地址只在 GitHub Actions 上算问题；在公司电脑上跑时内网地址是正常的。"""
    import ipaddress
    import socket
    on_ci = os.environ.get("GITHUB_ACTIONS") == "true"
    who = "GitHub 的服务器" if on_ci else "这台电脑"
    host = urllib.parse.urlsplit(base).hostname or ""
    if not host:
        return f"{name}：接口地址格式不对（解析不出域名）。应该像 https://api.example.com/v1"
    hint = []
    if on_ci and "." not in host:
        hint.append("域名里没有点，像是内网主机名")
    elif on_ci and re.search(r"\.(local|lan|internal|intranet|corp|home)$", host, re.I):
        hint.append("域名后缀像是公司或家庭内网")
    try:
        ips = {a[4][0] for a in socket.getaddrinfo(host, 443)}
    except socket.gaierror:
        if not on_ci:
            return f"{name}：{who}查不到接口地址的域名。检查 LLM_BASE 有没有拼错，以及这台电脑现在是否连着公司内网（VPN）。"
        return (f"{name}：{who}查不到这个接口地址的域名（DNS 解析失败）。"
                + ("".join("可能原因：" + h + "。" for h in hint))
                + "请检查：1) LLM_BASE 有没有拼错，复制时有没有多带空格或换行；"
                "2) 这个地址是不是只能在公司内网或特定网络里访问——GitHub Actions 在海外公网上运行，访问不到内网地址，这种情况要换成公网可用的接口。")
    if on_ci and any(ipaddress.ip_address(ip).is_private for ip in ips):
        return f"{name}：接口域名解析到的是内网 IP，GitHub Actions 访问不到。请换成公网可用的接口地址。"
    return ""


class LLM:
    def __init__(self):
        self.list = providers()
        self.calls = 0
        self.dead = set()

    def ok(self):
        return bool(self.list)

    def ask(self, system, user, max_tokens=3000):
        """返回模型输出的文本；所有接口都失败时抛出异常。"""
        err = None
        for name, base, key, model in self.list:
            if name in self.dead:
                continue
            for attempt in range(2):
                try:
                    body = json.dumps({"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                                       "temperature": 0.2, "max_tokens": max_tokens, "stream": False}).encode()
                    req = urllib.request.Request(base + "/chat/completions", data=body, method="POST",
                                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
                    with urllib.request.urlopen(req, timeout=180) as r:
                        j = json.loads(r.read())
                    self.calls += 1
                    text = j["choices"][0]["message"].get("content") or ""
                    return re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
                except urllib.error.HTTPError as e:
                    err = f"{name}: HTTP {e.code}"
                    if e.code in (401, 403, 404):  # Key 无效、没有权限、模型下线：换下一个
                        self.dead.add(name)
                        break
                    time.sleep(8 * (attempt + 1))  # 429 限流或 5xx：等一会儿再试
                except Exception as e:  # 超时、网络错误、返回格式不对
                    err = f"{name}: {type(e).__name__}: {e}"
                    time.sleep(4)
        raise RuntimeError("所有模型接口都失败了：" + str(err))

    def ask_json(self, system, user, max_tokens=3000):
        text = self.ask(system + "\n只输出一个 JSON，不要任何解释，不要 Markdown 代码块。", user, max_tokens)
        return loose_json(text)


def loose_json(s):
    s = str(s or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    for cand in (s, s[s.find("{"):s.rfind("}") + 1] if "{" in s else "", s[s.find("["):s.rfind("]") + 1] if "[" in s else ""):
        if not cand:
            continue
        try:
            return json.loads(cand)
        except ValueError:
            try:
                return json.loads(re.sub(r",\s*([}\]])", r"\1", cand))
            except ValueError:
                continue
    return None


# ---------- 1. 社区讨论 ----------
def update_community():
    import fetch_community as FC
    old = load(P["community"], {"items": []}) or {"items": []}
    report, items, reddit_ok = [], [], False
    for name, its, err in FS.fetch_reddit():
        report.append(f"{'失败' if err else '成功'} {name}: {len(its)} 条" + (f"（{err}）" if err else ""))
        reddit_ok = reddit_ok or bool(its)
        items += [x for x in its if "量化" in name or FS.AI_RE.search(x["t"]) or any(r.search(x["t"]) for r in FS.KW.values())]
    if not reddit_ok:  # Reddit 常拦截云服务器 IP：沿用上周的 Reddit 部分，并注明
        keep = [x for x in old.get("items", []) if x.get("src", "").startswith("Reddit")]
        items += keep
        report.append(f"Reddit 本周未抓到，沿用上周的 {len(keep)} 条")
    hn = FC.fetch_hn()
    report.append(f"{'成功' if hn else '失败'} Hacker News 高分: {len(hn)} 条")
    items += hn
    if not items:
        log("社区讨论：一条也没抓到，保留旧文件")
        return
    items.sort(key=lambda x: x["d"], reverse=True)
    dump(P["community"], {"updated": datetime.now(CST).strftime("%Y-%m-%d %H:%M"), "status": report, "items": items})
    log(f"社区讨论：{len(items)} 条（{'；'.join(report)}）")


# ---------- 2. 候选与程序核验 ----------
META_DATE = re.compile(r'(?:article:published_time|og:published_time|datePublished|publish(?:ed)?[_-]?date|"dateCreated")["\']?\s*(?:content=|:)\s*["\']([0-9]{4}-[0-9]{2}-[0-9]{2})', re.I)
TIME_TAG = re.compile(r'<time[^>]+datetime=["\']([0-9]{4}-[0-9]{2}-[0-9]{2})', re.I)
META_DESC = re.compile(r'<meta[^>]+(?:property|name)=["\'](?:og:description|description)["\'][^>]+content=["\']([^"\']{20,600})', re.I)


def verify(item):
    """打开原文。返回 (是否保留, 原因, 页面摘要)。
    404/410/连不上 → 丢掉；页面上能读到发布日期且比快照日期早 21 天以上 → 丢掉（转载旧文）。
    401/403/429 视为站点拦截爬虫：链接来自该站自己的 RSS，保留。"""
    url = item["u"]
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (learning-hub weekly check)", "Accept": "text/html,*/*"})
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read(300_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
            break
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 429):
                return True, f"站点拦截（{e.code}），按 RSS 保留", ""
            if e.code >= 500 and attempt == 0:
                time.sleep(3)
                continue
            return False, f"HTTP {e.code}", ""
        except Exception as e:
            if attempt == 0:
                time.sleep(3)
                continue
            return False, type(e).__name__, ""
    m = META_DATE.search(raw) or TIME_TAG.search(raw)
    if m:
        try:
            pub = datetime.strptime(m.group(1), "%Y-%m-%d").date()
            snap = datetime.strptime(item["d"], "%Y-%m-%d").date()
            if (snap - pub).days > 21:
                return False, f"原文日期 {pub} 太旧", ""
        except ValueError:
            pass
    d = META_DESC.search(raw)
    return True, "ok", html.unescape(d.group(1)).strip()[:300] if d else ""


def candidates(feed_ids, dropped):
    snap = (load(P["sources"], {}) or {}).get("items", [])
    cut = (TODAY - timedelta(days=8)).isoformat()
    by_track = {}
    for x in snap:
        if x.get("lvl") not in ("A", "B") or x.get("d", "") < cut or not x.get("u", "").startswith("http"):
            continue
        nid = news_id(x["u"])
        if nid in feed_ids or nid in dropped:
            continue
        for k in x.get("k", []):
            by_track.setdefault(k, []).append({**x, "id": nid})
    out = {}
    for k, its in by_track.items():
        its.sort(key=lambda x: x["d"], reverse=True)
        its.sort(key=lambda x: x["lvl"])  # 稳定排序：先 A 后 B，同级按日期新到旧
        per_src, pick = {}, []
        for x in its:  # 同一来源最多 4 条，避免某个大站占满
            if per_src.get(x["src"], 0) >= 4:
                continue
            per_src[x["src"]] = per_src.get(x["src"], 0) + 1
            pick.append(x)
            if len(pick) >= CAND_PER_TRACK:
                break
        out[k] = pick
    return out


def verify_all(cands):
    flat = {x["id"]: x for its in cands.values() for x in its}
    with ThreadPoolExecutor(12) as ex:
        res = dict(zip(flat, ex.map(verify, flat.values())))
    dropped = [f"{flat[i]['t'][:30]}（{why}）" for i, (ok, why, _) in res.items() if not ok]
    log(f"链接核验：{len(flat)} 条候选，丢掉 {len(dropped)} 条" + (f"：{'；'.join(dropped[:8])}" if dropped else ""))
    return {k: [{**x, "page": res[x["id"]][2]} for x in its if res[x["id"]][0]] for k, its in cands.items()}


# ---------- 前沿路线关键词匹配：和 src/core/routes.js 一致 ----------
def route_re(kw):
    parts = []
    for k in kw or []:
        if not k:
            continue
        if k.startswith("/") and k.rfind("/") > 0:
            parts.append(k[1:k.rfind("/")])
        elif re.fullmatch(r"[\x00-\x7f]+", k):
            parts.append(r"(?<![A-Za-z0-9])" + re.escape(k))
        else:
            parts.append(re.escape(k))
    try:
        return re.compile("|".join(parts), re.I) if parts else None
    except re.error:
        return None


def match_routes(text, track, routes):
    out = []
    for r in routes:
        if r["track"] != track:
            continue
        rx = route_re(r.get("kw"))
        if rx and rx.search(text):
            rid = r["into"] if r.get("status") == "merged" and r.get("into") else r["id"]
            if rid not in out:
                out.append(rid)
    return out


# ---------- 用户对 AI 整理结果的标记（可选） ----------
def read_marks():
    """返回 {资讯 ID: 标记人数}。来源：Supabase（内测用户，需要 service key）和/或 Gist（个人版）。读不到就返回空。"""
    count = {}

    def add(doc):
        for k, v in ((doc or {}).get("e") or {}).items():
            if v in ("wrong", "drop") and re.fullmatch(r"n[0-9a-f]{12}", k):
                count[k] = count.get(k, 0) + 1

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    users = 0
    if url and key:
        try:
            req = urllib.request.Request(url.rstrip("/") + "/rest/v1/docs?select=data&name=eq.marks", headers={"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": "Bearer " + key})
            with urllib.request.urlopen(req, timeout=30) as r:
                rows = json.loads(r.read())
            for row in rows:
                add(row.get("data"))
            users += len(rows)
        except Exception as e:
            log(f"读取内测用户标记失败：{type(e).__name__}")
    tok = os.environ.get("GIST_TOKEN")
    if tok:
        try:
            h = {"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"}
            with urllib.request.urlopen(urllib.request.Request("https://api.github.com/gists?per_page=100", headers=h), timeout=30) as r:
                gists = json.loads(r.read())
            for g in gists:
                f = (g.get("files") or {}).get("lh2-marks.json")
                if f:
                    with urllib.request.urlopen(urllib.request.Request(f["raw_url"], headers=h), timeout=30) as r:
                        add(json.loads(r.read()))
                    users += 1
                    break
        except Exception as e:
            log(f"读取 Gist 标记失败：{type(e).__name__}")
    if users:
        log(f"用户标记：{users} 位用户，{len(count)} 条被标为分错了或不该收")
    return count, users


# ---------- 3. AI 整理精选 ----------
SYS = ("你在维护一个个人学习网站的精选资讯。读者是准备做 AI 产品经理的学习者，产品和技术各占一半，"
       "关注 AI 真正落地的机会、新商机和老商机改造；量化方向指个人量化投资和交易。用中文，平实、准确，不夸张，不编造任何数字、日期或产品名。")


def curate(llm, track, cands, routes, wrong_examples):
    rlist = [r for r in routes if r["track"] == track["id"] and r.get("status") == "active"]
    lines = [f"{i}. [{x['lvl']}|{x['src']}|{x['d']}] {x['t']}" + (f" —— {(x.get('page') or x.get('s') or '')[:160]}" if (x.get('page') or x.get('s')) else "")
             for i, x in enumerate(cands)]
    prompt = (
        f"方向：{track['name']}（{track['id']}）。方向目标：{track.get('goal', '')}\n"
        f"这个方向的前沿路线：\n" + "\n".join(f"- {r['id']}：{r['title']}" for r in rlist) + "\n\n"
        f"本周的候选（已由程序核验链接可以打开、来源是官方或权威媒体）：\n" + "\n".join(lines) + "\n\n"
        + (f"用户上周标为“分错了”的例子，避免同类错误：\n" + "\n".join(wrong_examples[:10]) + "\n\n" if wrong_examples else "")
        + f"从候选里挑出最多 {PER_TRACK_NEW} 条真正值得这个方向的读者看的，宁缺毋滥：重要的模型/产品/框架发布、监管变化、重要论文、新趋势、落地案例与商业模式。"
        "跳过：和这个方向关系不大的、纯营销、重复报道同一件事的（留一手来源那条）、只是小版本修复的。\n"
        '输出 JSON：{"pick":[{"i":候选编号,"type":"news|paper|dir|biz","t":"中文标题，20 字以内，说清楚发生了什么","s":"一句中文说明，30–60 字，点出对产品或落地的意义","r":["相关前沿路线 ID，没有就空数组"]}]}'
    )
    data = llm.ask_json(SYS, prompt, 2500)
    picks = (data or {}).get("pick") if isinstance(data, dict) else None
    if not isinstance(picks, list):
        raise ValueError("模型没有返回可用的 JSON")
    rids = {r["id"] for r in rlist}
    out, used = [], set()
    for p in picks:
        if not isinstance(p, dict):
            continue
        i = p.get("i")
        if not isinstance(i, int) or not 0 <= i < len(cands) or i in used:
            continue
        t, s = str(p.get("t") or "").strip(), str(p.get("s") or "").strip()
        if not t or len(t) > 60 or len(s) > 160:
            continue
        x = cands[i]
        used.add(i)
        item = {"d": x["d"], "k": track["id"], "type": p.get("type") if p.get("type") in TYPES else "news",
                "t": t, "s": s, "u": x["u"], "src": x["src"], "lvl": x["lvl"], "ai": True}
        r = [rid for rid in (p.get("r") or []) if rid in rids][:2] or match_routes(f"{x['t']} {t} {s}", track["id"], routes)[:2]
        if r:
            item["r"] = r
        out.append(item)
        if len(out) >= PER_TRACK_NEW:
            break
    return out


# 交易所和监管规则类的条目长期有用，裁剪时保留
KEEP_SRC = re.compile(r"交易所|证监|监管|证券业协会|SEC|FINRA|欧盟委员会|期货业协会")


def trim_feed(items):
    out, by = [], {}
    for x in sorted(items, key=lambda x: x.get("d", ""), reverse=True):
        by.setdefault(x["k"], []).append(x)
    for k, its in by.items():
        keep = [x for x in its if x.get("type") == "news" and KEEP_SRC.search(x.get("src", ""))]
        rest = [x for x in its if x not in keep]
        out += keep + rest[:max(0, PER_TRACK_KEEP - len(keep))]
    return sorted(out, key=lambda x: x.get("d", ""), reverse=True)


# ---------- 4. 前沿路线精修 ----------
def next_id(prefix, used, letter):
    n = 1
    while f"{prefix}.{letter}{n:02d}" in used:
        n += 1
    return f"{prefix}.{letter}{n:02d}"


def refine_routes(llm, track, routes, recent, verified_urls):
    """recent：这个方向最近 3 周的资讯（快照 + 精选）。返回改动说明列表；直接修改 routes。"""
    mine = [r for r in routes if r["track"] == track["id"] and r.get("status") == "active"]
    hits = {r["id"]: 0 for r in mine}
    loose = []
    for x in recent:
        rs = match_routes(f"{x['t']} {x.get('s', '')}", track["id"], routes)
        for rid in rs:
            hits[rid] = hits.get(rid, 0) + 1
        if not rs and x.get("lvl") in ("A", "B"):
            loose.append(x)
    stage_ids = [s["id"] for s in track["stages"]]
    prompt = (
        f"方向：{track['name']}（{track['id']}）。理论阶段：" + "；".join(f"{s['id']} {s['title']}" for s in track["stages"]) + "\n\n"
        "现有前沿路线（ID｜名称｜关键词｜最近 3 周命中条数）：\n"
        + "\n".join(f"- {r['id']}｜{r['title']}｜{', '.join(r.get('kw', [])[:10])}｜{hits.get(r['id'], 0)}" for r in mine) + "\n\n"
        "最近 3 周没有归到任何路线的资讯（编号. 标题）：\n" + "\n".join(f"{i}. {x['t']}" for i, x in enumerate(loose[:60])) + "\n\n"
        "请做三件事，没有把握的就不做：\n"
        "1) kw：给现有路线补关键词，让上面没归类但明显属于它的资讯能命中。每条路线最多补 3 个，关键词要具体（产品名、技术名、协议名），不要“AI”“模型”这种泛词。\n"
        "2) new：如果没归类的资讯里有一个新话题，至少 3 条资讯都在讲它，并且和现有路线都不重复，就新建一条路线。最多 2 条。\n"
        "3) merge：如果两条现有路线讲的其实是同一件事，把命中少的合并进命中多的。最多 1 对。\n"
        '输出 JSON：{"kw":[{"id":"路线 ID","add":["关键词"]}],'
        '"new":[{"title":"路线名，12 字以内","desc":"两句话：发生了什么、看点是什么","from":"最相关的理论阶段 ID","kw":["关键词 4–8 个"],"items":[资讯编号],"learn":[{"text":"一个学习任务","mode":"theory 或 practice"}]}],'
        '"merge":[{"from":"被合并的路线 ID","into":"保留的路线 ID","why":"原因"}]}'
    )
    data = llm.ask_json(SYS, prompt, 2500)
    if not isinstance(data, dict):
        raise ValueError("模型没有返回可用的 JSON")
    notes, by_id = [], {r["id"]: r for r in routes}
    bad_kw = re.compile(r"^(ai|AI|人工智能|模型|大模型|model|models|llm|LLM|agent|agents|智能体|发布|更新|new)$")
    for k in data.get("kw") or []:
        r = by_id.get((k or {}).get("id"))
        if not r or r["track"] != track["id"] or r.get("status") != "active":
            continue
        add = [w.strip() for w in (k.get("add") or []) if isinstance(w, str) and 2 <= len(w.strip()) <= 40 and not bad_kw.match(w.strip())]
        add = [w for w in add if w.lower() not in {x.lower() for x in r.get("kw", [])}][:3]
        # 新关键词命中的资讯太多（超过 40%）说明太泛，不要
        add = [w for w in add if (rx := route_re([w])) and sum(1 for x in recent if rx.search(x["t"])) <= max(3, len(recent) * 0.4)]
        if add:
            r["kw"] = r.get("kw", []) + add
            r["updated"] = TODAY.isoformat()
            notes.append(f"{r['title']} 补关键词：{', '.join(add)}")
    used = {r["id"] for r in routes}
    for n in (data.get("new") or [])[:2]:
        if not isinstance(n, dict):
            continue
        title, desc = str(n.get("title") or "").strip()[:20], str(n.get("desc") or "").strip()[:200]
        kw = [w.strip() for w in (n.get("kw") or []) if isinstance(w, str) and 2 <= len(w.strip()) <= 40 and not bad_kw.match(w.strip())][:8]
        rx = route_re(kw)
        support = [x for x in recent if rx and rx.search(f"{x['t']} {x.get('s', '')}")]
        if not title or not desc or len(kw) < 2 or len(support) < 3:  # 少于 3 条进展的话题先不成路线
            continue
        if any(title == r["title"] for r in mine):
            continue
        rid = next_id(track["id"], used, "r")
        used.add(rid)
        learn = []
        for j, l in enumerate((n.get("learn") or [])[:2]):
            if isinstance(l, dict) and str(l.get("text") or "").strip():
                learn.append({"id": f"{rid}.l{j + 1:02d}", "text": str(l["text"]).strip()[:200], "mode": "practice" if l.get("mode") == "practice" else "theory"})
        frm = n.get("from") if n.get("from") in stage_ids else stage_ids[0]
        routes.append({"id": rid, "track": track["id"], "title": title, "from": frm, "desc": desc, "kw": kw, "status": "active",
                       "learn": learn, "updated": TODAY.isoformat(), "ai": True})
        notes.append(f"新路线：{title}（{len(support)} 条进展）")
    for m in (data.get("merge") or [])[:1]:
        a, b = by_id.get((m or {}).get("from")), by_id.get((m or {}).get("into"))
        if a and b and a is not b and a["track"] == b["track"] == track["id"] and a.get("status") == b.get("status") == "active":
            a["status"], a["into"], a["updated"] = "merged", b["id"], TODAY.isoformat()
            b["kw"] = b.get("kw", []) + [w for w in a.get("kw", []) if w not in b.get("kw", [])]
            notes.append(f"合并：{a['title']} → {b['title']}")
    return notes


# ---------- 5. 对理论路线的修改建议（待确认） ----------
def suggest(llm, track, picked, overlay_hint=""):
    if not picked:
        return []
    stages = "\n".join(f"- {s['id']} {s['title']}：" + "；".join(f"{i['id']} {i['text']}" for i in s["items"]) for s in track["stages"])
    news = "\n".join(f"{j}. {x['t']}：{x['s']}" for j, x in enumerate(picked))
    prompt = (
        f"方向：{track['name']}。理论路线（阶段 ID 和任务 ID）：\n{stages}\n\n本周精选：\n{news}\n\n"
        "只有当本周的变化足以影响理论路线时（关键框架改名或弃用、重要新协议或新模型改变了学习重点、监管新规），才提出修改建议。"
        "大多数周不需要任何建议，这时返回空数组。最多 2 条。修改只能是：改写某个任务（edit）、新增任务（add）、给阶段加资源（res，链接只能用本周精选的编号）。\n"
        '输出 JSON：{"sugs":[{"stage":"阶段 ID","title":"一句话标题","why":"原因，引用是哪条精选","ops":[{"op":"edit","id":"任务 ID","text":"改写后"},{"op":"add","text":"新任务","mode":"theory 或 practice"},{"op":"res","news":精选编号,"name":"资源名"}]}]}'
    )
    data = llm.ask_json(SYS, prompt, 1800)
    out = []
    for j, s in enumerate(((data or {}).get("sugs") or [])[:2] if isinstance(data, dict) else []):
        st = next((x for x in track["stages"] if x["id"] == (s or {}).get("stage")), None)
        if not st:
            continue
        ids, ops = {i["id"] for i in st["items"]}, []
        for op in s.get("ops") or []:
            if not isinstance(op, dict):
                continue
            if op.get("op") == "edit" and op.get("id") in ids and str(op.get("text") or "").strip():
                ops.append({"op": "edit", "id": op["id"], "text": str(op["text"]).strip()[:300]})
            elif op.get("op") == "add" and str(op.get("text") or "").strip():
                ops.append({"op": "add", "text": str(op["text"]).strip()[:300], "mode": "practice" if op.get("mode") == "practice" else "theory", "ai": True})
            elif op.get("op") == "res" and isinstance(op.get("news"), int) and 0 <= op["news"] < len(picked):
                x = picked[op["news"]]
                ops.append({"op": "res", "name": str(op.get("name") or x["t"]).strip()[:120], "url": x["u"], "ai": True})
        if ops:
            out.append({"id": f"w{TODAY.strftime('%Y%m%d')}-{track['id']}-{j + 1}", "track": track["id"], "stage": st["id"],
                        "title": str(s.get("title") or "根据本周变化调整")[:60], "why": str(s.get("why") or "")[:200], "ops": ops, "at": TODAY.isoformat()})
    return out


# ---------- 主流程 ----------
# 分两段，可以在不同的机器上跑：
#   collect（采集）：抓社区讨论、读用户标记、挑候选并逐条核验链接，写 data/weekly-candidates.json。只需要公网，GitHub Actions 上跑。
#   ai（整理）：读候选，调用模型写精选、精修前沿路线、生成待确认建议。在能连上模型接口的机器上跑。
# 不加 --stage 就两段连着跑（模型接口公网可达时，全在 Actions 上完成）。
# 公司内网的模型接口 Actions 连不上：Actions 只跑 collect，公司电脑每天检查一次，有新候选就跑 ai 并推送（见 tools/weekly_local.sh）。
CAND = ROOT / "data" / "weekly-candidates.json"


def collect():
    feed = load(P["feed"])
    marks, users = read_marks()
    feed_ids = {news_id(x["u"]) for x in feed["items"]}
    cands = verify_all(candidates(feed_ids, set(marks)))
    # 前沿路线精修要用最近 3 周的快照；快照不进仓库，这里存一份精简版给整理那一段用
    snap = (load(P["sources"], {}) or {}).get("items", []) + (load(P["community"], {}) or {}).get("items", [])
    cut = (TODAY - timedelta(days=21)).isoformat()
    recent = [{k: x[k] for k in ("d", "k", "t", "s", "lvl") if k in x} for x in snap if x.get("d", "") >= cut]
    data = {"week": TODAY.isoformat(), "cands": cands, "recent": recent, "marked": sorted(marks)}
    dump(CAND, data, compact=True)
    log(f"候选已写入 data/weekly-candidates.json：{sum(len(v) for v in cands.values())} 条候选，{len(recent)} 条近 3 周资讯")
    return data


def organize(llm, data, dry):
    feed = load(P["feed"])
    routes_doc = load(P["routes"])
    sugs_doc = load(P["sugs"], {"items": []}) or {"items": []}
    tids = [t for d in load(P["domains"]) for t in d["tracks"]]
    tracks = [load(ROOT / "content" / "tracks" / f"{t}.json") for t in tids]
    routes = routes_doc["routes"]

    # 用户标记：被标为“分错了/不该收”的 AI 整理条目下架，并作为反例告诉模型
    marked = set(data.get("marked") or [])
    wrong, keep = [], []
    for x in feed["items"]:
        if x.get("ai") and news_id(x["u"]) in marked:
            wrong.append(f"- 《{x['t']}》被归到 {x['k']}" + (f"、路线 {','.join(x.get('r', []))}" if x.get("r") else ""))
        else:
            keep.append(x)
    if wrong:
        log(f"按用户标记下架 {len(wrong)} 条 AI 整理的精选")
    feed["items"] = keep
    feed_ids = {news_id(x["u"]) for x in feed["items"]}

    cands = data["cands"]
    added, fails, new_items = {}, 0, []
    for t in tracks:
        cs = [x for x in cands.get(t["id"], []) if x["id"] not in feed_ids]
        if not cs:
            continue
        try:
            got = curate(llm, t, cs, routes, wrong)
        except Exception as e:
            fails += 1
            log(f"{t['name']}：AI 整理失败（{e}），本周不新增")
            continue
        got = [x for x in got if news_id(x["u"]) not in feed_ids]
        feed_ids |= {news_id(x["u"]) for x in got}
        new_items += got
        added[t["id"]] = got
        log(f"{t['name']}：新增 {len(got)} 条精选" + (f"，例如《{got[0]['t']}》" if got else ""))
    if fails and fails == len([t for t in tracks if cands.get(t["id"])]):
        log("所有方向的 AI 整理都失败了，内容保持上周的版本")
        return 1
    feed["items"] = trim_feed(feed["items"] + new_items)
    feed["updated"] = TODAY.isoformat()
    feed["weekly"] = data["week"]   # 记下处理过哪一周的候选，同一周不会重复整理

    cut = (TODAY - timedelta(days=21)).isoformat()
    route_notes = []
    for t in tracks:
        recent = [x for x in data.get("recent", []) if t["id"] in x.get("k", [])] + \
                 [x for x in feed["items"] if x["k"] == t["id"] and x.get("d", "") >= cut]
        if len(recent) < 5:
            continue
        try:
            route_notes += [f"{t['name']} · {n}" for n in refine_routes(llm, t, routes, recent, feed_ids)]
        except Exception as e:
            log(f"{t['name']}：前沿路线精修失败（{e}），路线保持不变")
    for n in route_notes:
        log("前沿路线 " + n)
    routes_doc["updated"] = TODAY.isoformat()

    old = [s for s in sugs_doc.get("items", []) if s.get("at", "") >= (TODAY - timedelta(days=28)).isoformat()]
    new_s = []
    for t in tracks:
        try:
            new_s += suggest(llm, t, added.get(t["id"], []))
        except Exception as e:
            log(f"{t['name']}：生成修改建议失败（{e}）")
    old_ids = {s["id"] for s in old}
    sugs_doc = {"updated": TODAY.isoformat(), "items": [s for s in new_s if s["id"] not in old_ids] + old}
    for s in new_s:
        log(f"待确认建议：{s['title']}（{s['stage']}）")

    log(f"模型调用 {llm.calls} 次")
    if dry:
        print(json.dumps({"new": new_items, "sugs": new_s}, ensure_ascii=False, indent=1)[:6000])
        return 0
    dump(P["feed"], feed)
    dump(P["routes"], routes_doc)
    dump(P["sugs"], sugs_doc)
    return 0


def make_llm():
    """返回 (LLM, 失败原因)。"""
    llm = LLM()
    if not llm.ok():
        return None, "没有配置任何模型 Key（MODELSCOPE_KEY / SILICONFLOW_KEY / ZHIPU_KEY / LLM_BASE+LLM_KEY+LLM_MODEL）"
    bad = [m for m in (check_base(n, b) for n, b, _, _ in llm.list) if m]
    for m in dict.fromkeys(bad):
        log(m)
    if len(bad) == len(llm.list):
        return None, "所有模型接口的地址都连不上"
    return llm, ""


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="每周自动更新")
    ap.add_argument("--stage", choices=["all", "collect", "ai", "auto"], default="all",
                    help="all：采集+整理；collect：只采集候选；ai：只整理（读 data/weekly-candidates.json）；"
                         "auto：先采集，模型接口连得上就接着整理，连不上就只留候选给公司电脑")
    ap.add_argument("--no-ai", action="store_true", help="等同 --stage collect")
    ap.add_argument("--dry-run", action="store_true", help="不写文件，只打印结果")
    ap.add_argument("--skip-community", action="store_true", help="跳过 Reddit/HN 抓取")
    ap.add_argument("--force", action="store_true", help="ai 阶段：这一周已经整理过也重新整理")
    a = ap.parse_args()
    stage = "collect" if a.no_ai else a.stage

    if stage in ("all", "collect", "auto"):
        if not P["sources"].exists():
            log("没有 data/sources.json，请先运行 python3 tools/fetch_sources.py")
            return finish(1)
        if not a.skip_community and not a.dry_run:
            try:
                update_community()
            except Exception as e:
                log(f"社区讨论抓取出错：{type(e).__name__}: {e}")
        data = collect()
        if stage == "collect":
            return finish(0)
        llm, why = make_llm()
        if not llm:
            if stage == "auto":
                log(f"{why}：本周只采集了候选，等能连上模型接口的电脑（如公司内网）整理")
                return finish(0)
            log(why + "，本周只更新了社区讨论和候选")
            return finish(1)
        return finish(organize(llm, data, a.dry_run))

    # stage == "ai"
    data = load(CAND)
    if not data or not data.get("cands"):
        log("没有 data/weekly-candidates.json，先等每周一的云端采集（或运行 --stage collect）")
        return finish(1)
    age = (TODAY - datetime.strptime(data["week"], "%Y-%m-%d").date()).days
    if (load(P["feed"]) or {}).get("weekly") == data["week"] and not a.force:
        log(f"{data['week']} 这一周的候选已经整理过了，不重复整理")
        return finish(0)
    if age > 10:
        log(f"候选是 {data['week']} 采集的，已经 {age} 天，太旧了。等下周一的新候选")
        return finish(0)
    llm, why = make_llm()
    if not llm:
        log(why)
        return finish(1)
    return finish(organize(llm, data, a.dry_run))


def finish(code):
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## 每周更新 {TODAY.isoformat()}\n\n" + "\n".join(f"- {m}" for m in REPORT) + "\n")
    (ROOT / "data" / "weekly-report.txt").write_text(f"每周更新 {TODAY.isoformat()}\n" + "\n".join(REPORT) + "\n", encoding="utf-8")
    sys.exit(code)


if __name__ == "__main__":
    main()
