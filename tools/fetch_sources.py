#!/usr/bin/env python3
"""抓取官方博客、权威媒体、arXiv、项目 Release 和社区高票讨论的 RSS/Atom，生成 data/sources.js 供网页离线读取。

只用标准库。用法：python3 tools/fetch_sources.py
浏览器不能跨域读取这些 RSS，所以由本脚本（每日定时任务）抓取后写成本地快照。
"""
import gzip
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "sources.js"
KEEP_DAYS = 45
MAX_PER_SOURCE = 40

# (名称, 链接, 可信度 A=一手/官方 B=权威媒体与研究者, 默认板块, 是否只收录命中关键词的条目[, 最多条数])
SOURCES = [
    ("OpenAI 官方", "https://openai.com/news/rss.xml", "A", ["llm"], False),
    ("Google AI 博客", "https://blog.google/technology/ai/rss/", "A", ["llm"], False),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml", "A", ["llm"], False),
    ("Hugging Face 博客", "https://huggingface.co/blog/feed.xml", "A", ["llm"], False),
    ("Microsoft Research", "https://www.microsoft.com/en-us/research/feed/", "A", [], True),
    ("NVIDIA 博客", "https://blogs.nvidia.com/feed/", "A", [], True),
    ("AWS 机器学习博客", "https://aws.amazon.com/blogs/machine-learning/feed/", "A", [], True),
    ("Cloudflare 博客", "https://blog.cloudflare.com/rss/", "A", [], True),
    ("MCP 官方博客", "https://blog.modelcontextprotocol.io/index.xml", "A", ["agent"], False),
    ("arXiv 量化金融", "https://export.arxiv.org/api/query?search_query=cat:q-fin.TR+OR+cat:q-fin.PM+OR+cat:q-fin.ST+OR+cat:q-fin.CP&sortBy=submittedDate&sortOrder=descending&max_results=40", "A", ["quant"], False),
    ("TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", "B", ["llm"], False),
    ("The Verge AI", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "B", ["llm"], False),
    ("Ars Technica AI", "https://arstechnica.com/ai/feed/", "B", ["llm"], False),
    ("MIT Technology Review", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "B", ["llm"], False),
    ("量子位", "https://www.qbitai.com/feed", "B", ["llm"], False),
    ("Simon Willison", "https://simonwillison.net/atom/everything/", "B", [], True),
    ("Interconnects", "https://www.interconnects.ai/feed", "B", ["llm"], False),
    ("Latent Space", "https://www.latent.space/feed", "B", ["llm"], False),
    ("Sebastian Raschka", "https://magazine.sebastianraschka.com/feed", "B", ["llm"], False),
    ("Lilian Weng", "https://lilianweng.github.io/index.xml", "B", ["llm"], False),
    # 更多官方来源
    ("Microsoft 官方博客", "https://blogs.microsoft.com/feed/", "A", [], True),
    ("Salesforce 新闻", "https://www.salesforce.com/news/feed/", "A", ["agent"], True),
    ("Together AI 博客", "https://www.together.ai/blog/rss.xml", "A", ["llm"], False, 15),
    ("SEC 新闻稿", "https://www.sec.gov/news/pressreleases.rss", "A", ["quant"], True),
    # 更多权威媒体与研究者
    ("Bloomberg 科技", "https://feeds.bloomberg.com/technology/news.rss", "B", [], True),
    ("Financial Times AI", "https://www.ft.com/artificial-intelligence?format=rss", "B", ["llm"], False),
    ("CNBC 科技", "https://www.cnbc.com/id/19854910/device/rss/rss.html", "B", [], True),
    ("The Decoder", "https://the-decoder.com/feed/", "B", ["llm"], False),
    ("36氪", "https://www.36kr.com/feed", "B", [], True),
    ("InfoQ 中文", "https://www.infoq.cn/feed", "B", [], True),
    ("雷锋网", "https://www.leiphone.com/feed", "B", [], True),
    ("SemiAnalysis", "https://newsletter.semianalysis.com/feed", "B", ["llm"], False),
    ("Import AI（Jack Clark）", "https://jack-clark.net/feed/", "B", ["llm"], False),
    ("One Useful Thing（Ethan Mollick）", "https://www.oneusefulthing.org/feed", "B", ["llm"], False),
    ("AI Snake Oil", "https://www.aisnakeoil.com/feed", "B", ["llm"], False),
    # 量化专业媒体与研究博客
    ("Risk.net 前沿研究", "https://www.risk.net/feeds/rss/category/cutting-edge", "B", ["quant"], False, 15),
    ("Alpha Architect", "https://alphaarchitect.com/feed/", "B", ["quant"], False),
    ("Quantocracy（量化博客精选）", "https://quantocracy.com/feed/", "B", ["quant"], False),
    ("QuantInsti 博客", "https://blog.quantinsti.com/rss/", "B", ["quant"], False),
    # 社区讨论（C 级：只代表关注度，内容未核实）。Reddit 和 Hacker News 由 tools/fetch_community.py 每周抓取
    ("Lobsters AI", "https://lobste.rs/t/ai.rss", "C", [], True, 15),
    # 重要开源项目的官方 Release（A 级一手），每个只取最近几个版本
    ("Ollama Release", "https://github.com/ollama/ollama/releases.atom", "A", ["slm"], False, 4),
    ("vLLM Release", "https://github.com/vllm-project/vllm/releases.atom", "A", ["slm"], False, 4),
    ("MLX-LM Release", "https://github.com/ml-explore/mlx-lm/releases.atom", "A", ["slm"], False, 4),
    ("Unsloth Release", "https://github.com/unslothai/unsloth/releases.atom", "A", ["slm"], False, 4),
    ("LLaMA-Factory Release", "https://github.com/hiyouga/LLaMA-Factory/releases.atom", "A", ["slm"], False, 4),
    ("OpenAI Agents SDK Release", "https://github.com/openai/openai-agents-python/releases.atom", "A", ["agent"], False, 3),
    ("LangGraph Release", "https://github.com/langchain-ai/langgraph/releases.atom", "A", ["agent"], False, 3),
    ("MCP 规范 Release", "https://github.com/modelcontextprotocol/modelcontextprotocol/releases.atom", "A", ["agent"], False, 3),
    ("TradingAgents Release", "https://github.com/TauricResearch/TradingAgents/releases.atom", "A", ["quant", "agent"], False, 3),
    ("Qlib Release", "https://github.com/microsoft/qlib/releases.atom", "A", ["quant"], False, 3),
    ("RD-Agent Release", "https://github.com/microsoft/RD-Agent/releases.atom", "A", ["quant"], False, 3),
    ("vn.py Release", "https://github.com/vnpy/vnpy/releases.atom", "A", ["quant"], False, 3),
    ("AKShare Release", "https://github.com/akfamily/akshare/releases.atom", "A", ["quant"], False, 3),
]

KW = {
    "llm": r"\bLLMs?\b|language model|GPT|Claude|Gemini|DeepSeek|Qwen|Llama|Kimi|GLM|reasoning|frontier model|pre-?train|post-?train|RLHF|inference|大模型|模型发布|推理模型",
    "slm": r"small (language )?model|\bSLMs?\b|on-device|edge AI|local model|fine-?tun|LoRA|distill|quantiz|Gemma|Phi-|SmolLM|MiniCPM|llama\.cpp|Ollama|\bMLX\b|embedding|端侧|小模型|微调|蒸馏",
    "agent": r"\bagents?\b|agentic|\bMCP\b|\bA2A\b|tool use|computer use|browser use|Codex|Claude Code|copilot|智能体|Agent",
    "quant": r"financ|trading|\bstocks?\b|stock market|portfolio|hedge fund|asset pric|backtest|\bquant(itative)?\b|量化|金融|证券|股票|基金|投研",
}
KW = {k: re.compile(v, re.I) for k, v in KW.items()}
# 非量化专门来源的条目，标题必须明确涉及交易/投资才归入量化板块
QUANT_STRICT = re.compile(r"\bquant(itative)?\b|trading|hedge fund|stock market|\bstocks?\b|asset manag|investment research|portfolio|量化|证券|股票|投研|基金|券商", re.I)
PRE_RE = re.compile(r"rc\d|\b(alpha|beta|dev|nightly)\b", re.I)
AI_RE = re.compile(r"\bAI\b|machine learning|model|LLM|agent|neural|人工智能|模型", re.I)

UA = {"User-Agent": "Mozilla/5.0 (learning-hub feed fetcher)"}

# Reddit 每周高票帖（C 级社区讨论），由 tools/fetch_community.py 调用，不在每日任务里抓：
# Reddit 经常拦截云服务器 IP，改为每周更新时在个人电脑上抓。限流严格，按顺序抓、每次间隔几秒。
# X(Twitter) 没有免费可用的公开接口，不抓取。
REDDIT = [
    ("Reddit r/LocalLLaMA", "LocalLLaMA", ["slm", "llm"]),
    ("Reddit 大模型综合", "MachineLearning+singularity+OpenAI+ClaudeAI+Bard", ["llm"]),
    ("Reddit 智能体", "AI_Agents+mcp+ClaudeCode+AutoGPT", ["agent"]),
    ("Reddit 量化", "algotrading+quant", ["quant"]),
]
REDDIT_UA = {"User-Agent": "linux:learning-hub:v1.0 (by /u/pawsey0319)"}


def text(el):
    return "" if el is None else "".join(el.itertext()).strip()


def parse_date(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def parse_feed(raw):
    """同时兼容 RSS 2.0 与 Atom，返回 [(title, link, date, summary)]。"""
    root = ET.fromstring(raw)
    out = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        title = link = date = summ = ""
        for ch in it:
            t = ch.tag.split("}")[-1]
            if t == "title":
                title = text(ch)
            elif t == "link":
                href = ch.get("href")
                if href and ch.get("rel", "alternate") == "alternate":
                    link = link or href
                elif not href:
                    link = link or text(ch)
            elif t in ("pubDate", "published", "updated", "date") and not date:
                date = text(ch)
            elif t in ("description", "summary") and not summ:
                summ = text(ch)
        if title and link:
            out.append((strip_tags(title), link.strip(), parse_date(date), strip_tags(summ)[:400]))
    return out


def fetch(src):
    name, url, lvl, default, need_kw = src[:5]
    cap = src[5] if len(src) > 5 else MAX_PER_SOURCE
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
        if raw[:2] == b"\x1f\x8b":  # 有些站点无视请求头直接返回 gzip
            raw = gzip.decompress(raw)
        entries = parse_feed(raw)
    except Exception as e:  # 单个源失败不影响其他源
        return name, [], f"{type(e).__name__}: {e}"
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    items = []
    for title, link, d, summ in entries[:MAX_PER_SOURCE * 2]:
        if not d or d < cutoff or not link.startswith(("http://", "https://")):
            continue
        if "Release" in name and PRE_RE.search(title):  # 跳过预发布版本
            continue
        blob = f"{title} {summ}"
        ks = [k for k, r in KW.items() if r.search(blob)]
        if need_kw:
            if not ks or not AI_RE.search(blob):
                continue
        else:
            ks = sorted(set(ks) | set(default))
        # 通用科技媒体里的金融新闻，只有同时涉及 AI 才归入量化板块
        if "quant" in ks and "quant" not in default and not QUANT_STRICT.search(title):
            ks.remove("quant")
        if not ks:
            continue
        items.append({"d": d.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d"),
                      "src": name, "lvl": lvl, "k": ks, "t": title[:160], "u": link})
        if len(items) >= cap:
            break
    return name, items, None


def fetch_reddit():
    out = []
    for i, (name, subs, ks) in enumerate(REDDIT):
        if i:
            time.sleep(6)
        url = f"https://www.reddit.com/r/{subs}/top/.rss?t=week&limit=25"
        entries, err = None, None
        for wait in (0, 15, 30):  # 被限流（429）时等一会儿重试
            time.sleep(wait)
            try:
                req = urllib.request.Request(url, headers=REDDIT_UA)
                with urllib.request.urlopen(req, timeout=30) as r:
                    entries = parse_feed(r.read())
                break
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                if "429" not in err:
                    break
        if entries is None:
            out.append((name, [], err))
            continue
        items = [{"d": d.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d"), "src": name, "lvl": "C",
                  "k": ks, "t": t[:160], "u": l} for t, l, d, _ in entries if d and l.startswith("https://")][:12]
        out.append((name, items, None))
    return out


def fetch_hf_daily():
    """Hugging Face 每日论文，作为网页在打不开 huggingface.co 时的兜底数据。"""
    for base in ("https://huggingface.co", "https://hf-mirror.com"):
        try:
            req = urllib.request.Request(base + "/api/daily_papers?limit=100", headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            return [{"id": x["paper"]["id"], "t": x["paper"]["title"], "s": (x["paper"].get("summary") or "")[:300],
                     "v": x["paper"].get("upvotes", 0), "d": x.get("publishedAt", "")[:10]} for x in data]
        except Exception:
            continue
    return []


def main():
    try:  # Windows 控制台默认编码不是 UTF-8，避免打印中文时报错
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    with ThreadPoolExecutor(16) as ex:
        results = list(ex.map(fetch, SOURCES))
    items, report = [], []
    seen = set()
    for name, its, err in results:
        report.append(f"{'失败' if err else '成功'} {name}: {len(its)} 条" + (f"（{err}）" if err else ""))
        for x in its:
            key = x["u"].split("?")[0].rstrip("/")
            if key not in seen:
                seen.add(key)
                items.append(x)
    items.sort(key=lambda x: x["d"], reverse=True)
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    names = [{"name": s[0], "lvl": s[2]} for s in SOURCES]
    data = {"updated": now, "sources": names, "status": report, "items": items, "hf": fetch_hf_daily()}
    OUT.write_text("/* 由 tools/fetch_sources.py 自动生成，请勿手改 */\nHUB.sources = "
                   + json.dumps(data, ensure_ascii=False, indent=0) + ";\n", encoding="utf-8")
    print(f"已写入 {OUT}，共 {len(items)} 条，更新时间 {now}")
    print("\n".join(report))
    ok = sum(1 for _, _, e in results if not e)
    sys.exit(0 if ok >= len(results) // 2 else 1)


if __name__ == "__main__":
    main()
