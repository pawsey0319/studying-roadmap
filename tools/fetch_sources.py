#!/usr/bin/env python3
"""抓取官方博客、权威媒体、arXiv、项目 Release 和社区高票讨论的 RSS/Atom，生成 data/sources.json 供网页离线读取。

只用标准库。用法：python3 tools/fetch_sources.py
浏览器不能跨域读取这些 RSS，所以由本脚本（每日定时任务）抓取后写成本地快照。
"""
import gzip
import html
import html.parser
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
OUT = ROOT / "data" / "sources.json"
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
    # ---- 2026-11 新增：国外 newsletter（二手聚合，B 级只收命中关键词的条目） ----
    ("Ben's Bites", "https://www.bensbites.com/feed", "B", [], True, 10),
    ("The Rundown AI", "https://www.therundown.ai/feed", "B", [], True, 10),
    ("TheSequence", "https://thesequence.substack.com/feed", "B", ["llm"], False, 10),
    ("Last Week in AI", "https://lastweekin.ai/feed", "B", ["llm"], False, 6),
    ("AI Weekly", "https://aiweekly.co/issues.rss", "B", ["llm"], False, 6),
    # BestBlogs：AI 打分 90 分以上的中英文文章、播客、视频（链接指向 bestblogs.dev 的摘要页，原文在页内）
    ("BestBlogs 高分精选", "https://www.bestblogs.dev/en/feeds/rss?category=ai&minScore=90", "B", [], True, 30),
    # ---- 微信公众号（经 wechat2rss.bestblogs.dev 转成 RSS）：模型厂商官方号 A 级，科技媒体 B 级 ----
    ("公众号 · DeepSeek", "https://wechat2rss.bestblogs.dev/feed/1709da4f538d4ce4fb6d7a8ba1a5a1c297919601.xml", "A", ["llm"], False, 5),
    ("公众号 · 智谱", "https://wechat2rss.bestblogs.dev/feed/433d2134dca54d80804daf32e8be546155be3300.xml", "A", ["llm"], False, 5),
    ("公众号 · 通义大模型", "https://wechat2rss.bestblogs.dev/feed/4ebee6222ae08705b8aabc9116f0defbcb6b17c6.xml", "A", ["llm"], False, 5),
    ("公众号 · 月之暗面 Kimi", "https://wechat2rss.bestblogs.dev/feed/c5c43d4bc17bae656763859ed0903bb6314ec6fe.xml", "A", ["llm"], False, 5),
    ("公众号 · 腾讯混元", "https://wechat2rss.bestblogs.dev/feed/306ce19a1ca590c9c2df781789e828d1acfa1356.xml", "A", ["llm"], False, 5),
    ("公众号 · 阶跃星辰", "https://wechat2rss.bestblogs.dev/feed/3e2714d06aa36142e8ed6b3f4e5cf9090a069dd2.xml", "A", ["llm"], False, 5),
    ("公众号 · MiniMax", "https://wechat2rss.bestblogs.dev/feed/00306b171f754d463b28cf83f3ba086ad009b430.xml", "A", ["llm"], False, 5),
    ("公众号 · 字节跳动 Seed", "https://wechat2rss.bestblogs.dev/feed/6efd40bb335d2037f365d284cb5e00f0843e737e.xml", "A", ["llm"], False, 5),
    ("公众号 · 魔搭 ModelScope 社区", "https://wechat2rss.bestblogs.dev/feed/d993a885260f96057b9a4c96212cb2c95bb5054b.xml", "A", ["slm"], False, 5),
    ("公众号 · 机器之心", "https://wechat2rss.bestblogs.dev/feed/8d97af31b0de9e48da74558af128a4673d78c9a3.xml", "B", [], True, 6),
    ("公众号 · 新智元", "https://wechat2rss.bestblogs.dev/feed/e531a18b21c34cf787b83ab444eef659d7a980de.xml", "B", [], True, 6),
    ("公众号 · 晚点 LatePost", "https://wechat2rss.bestblogs.dev/feed/c442206ec9957f3c52f2f40300ca532079538b31.xml", "B", [], True, 6),
    ("公众号 · 海外独角兽", "https://wechat2rss.bestblogs.dev/feed/7200d3a5e976d231deb1e40ad33745c0e649b029.xml", "B", [], True, 6),
    ("公众号 · 智东西", "https://wechat2rss.bestblogs.dev/feed/cfd52b4245ca6119b2fda4ef934832c689028927.xml", "B", [], True, 6),
    ("公众号 · 甲子光年", "https://wechat2rss.bestblogs.dev/feed/1c4008936645d5c17239d99bba91522cf2bdfa26.xml", "B", [], True, 6),
    ("公众号 · AI 前线", "https://wechat2rss.bestblogs.dev/feed/25185b01482da0f485418ecb92e208b4416712fb.xml", "B", [], True, 6),
    ("公众号 · 腾讯科技", "https://wechat2rss.bestblogs.dev/feed/a81bdfcbb9eefe870d285e81510ffa1af26e4520.xml", "B", [], True, 6),
    ("公众号 · 硅星人 Pro", "https://wechat2rss.bestblogs.dev/feed/c62ceda9eed269d851802bdbc5f33c4fabbf7462.xml", "B", [], True, 6),
    ("公众号 · Founder Park", "https://wechat2rss.bestblogs.dev/feed/f940695505f2be1399d23cc98182297cadf6f90d.xml", "B", [], True, 6),
    ("公众号 · 42章经", "https://wechat2rss.bestblogs.dev/feed/f6694726ced4ba3d7c7cd65c6edf2160c5978387.xml", "B", [], True, 6),
    # ---- X（经 api.xgo.ing 转成 RSS，不需要登录）：官方账号 A 级，知名研究者 B 级，中文 AI 博主 C 级 ----
    ("X · OpenAI", "https://api.xgo.ing/rss/user/0c0856a69f9f49cf961018c32a0b0049", "A", ["llm"], False, 5),
    ("X · OpenAI Developers", "https://api.xgo.ing/rss/user/971dc1fc90da449bac23e5fad8a33d55", "A", ["agent"], False, 5),
    ("X · Anthropic", "https://api.xgo.ing/rss/user/fc28a211471b496682feff329ec616e5", "A", ["llm"], False, 5),
    ("X · Claude", "https://api.xgo.ing/rss/user/01f60d63a61b44d692cc35c7feb0b4a4", "A", ["agent"], False, 5),
    ("X · Google DeepMind", "https://api.xgo.ing/rss/user/a99538443a484fcc846bdcc8f50745ec", "A", ["llm"], False, 5),
    ("X · DeepSeek", "https://api.xgo.ing/rss/user/68b610deb24b47ae9a236811563cda86", "A", ["llm"], False, 5),
    ("X · Qwen", "https://api.xgo.ing/rss/user/80032d016d654eb4afe741ff34b7643d", "A", ["llm"], False, 5),
    ("X · AI at Meta", "https://api.xgo.ing/rss/user/ef7c70f9568d45f4915169fef4ce90b4", "A", ["llm"], False, 5),
    ("X · Mistral AI", "https://api.xgo.ing/rss/user/8d2d03aea8af49818096da4ea00409d1", "A", ["llm"], False, 5),
    ("X · Hugging Face", "https://api.xgo.ing/rss/user/fc16750ce50741f1b1f05ea1fb29436f", "A", ["slm"], False, 5),
    ("X · xAI", "https://api.xgo.ing/rss/user/3953aa71e87a422eb9d7bf6ff1c7c43e", "A", ["llm"], False, 5),
    ("X · Cursor", "https://api.xgo.ing/rss/user/5287b4e0e13a4ab7ab7b1d56f9d88960", "A", ["agent"], False, 5),
    ("X · Andrej Karpathy", "https://api.xgo.ing/rss/user/edf707b5c0b248579085f66d7a3c5524", "B", [], True, 5),
    ("X · Andrew Ng", "https://api.xgo.ing/rss/user/08b5488b20bc437c8bfc317a52e5c26d", "B", [], True, 5),
    ("X · Jim Fan", "https://api.xgo.ing/rss/user/c6cfe7c0d6b74849997073233fdea840", "B", [], True, 5),
    ("X · AK（论文速递）", "https://api.xgo.ing/rss/user/341f7b9f8d9b477e8bb200caa7f32c6e", "B", [], True, 5),
    ("X · elvis（omarsar0）", "https://api.xgo.ing/rss/user/931d6e88e067496cac6bf23f69d60f33", "B", [], True, 5),
    ("X · 宝玉", "https://api.xgo.ing/rss/user/97f1484ae48c430fbbf3438099743674", "C", [], True, 5),
    ("X · 歸藏", "https://api.xgo.ing/rss/user/831fac36aa0a49a9af79f35dc1c9b5d9", "C", [], True, 5),
    # ---- 量化：美联储新闻稿只收货币政策相关 ----
    ("美联储新闻稿", "https://www.federalreserve.gov/feeds/press_all.xml", "A", ["quant"], False, 6, r"FOMC|monetary policy|federal funds|interest rate|Beige Book|minutes"),
]

KW = {
    "llm": r"\bLLMs?\b|language model|GPT|Claude|Gemini|DeepSeek|Qwen|Llama|Kimi|GLM|reasoning|frontier model|pre-?train|post-?train|RLHF|inference|大模型|模型发布|推理模型",
    "slm": r"small (language )?model|\bSLMs?\b|on-device|edge AI|local model|fine-?tun|LoRA|distill|quantiz|Gemma|Phi-|SmolLM|MiniCPM|llama\.cpp|Ollama|\bMLX\b|embedding|端侧|小模型|微调|蒸馏",
    "agent": r"\bagents?\b|agentic|\bMCP\b|\bA2A\b|tool use|computer use|browser use|Codex|Claude Code|copilot|智能体|Agent",
    "quant": r"financ|trading|\bstocks?\b|stock market|portfolio|hedge fund|asset pric|backtest|\bquant(itative)?\b|量化|金融|证券|股票|基金(?!会)|投研",
}
KW = {k: re.compile(v, re.I) for k, v in KW.items()}
# 非量化专门来源的条目，标题必须明确涉及交易/投资才归入量化板块
QUANT_STRICT = re.compile(r"\bquant(itative)?\b|trading|hedge fund|stock market|\bstocks?\b|asset manag|investment research|portfolio|量化|证券|股票|投研|基金(?!会)|券商", re.I)
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


def clean_link(u):
    """去掉 utm_* 等跟踪参数，其余参数原样保留（微信文章的 __biz/mid 等参数必须保留）。"""
    x = urllib.parse.urlsplit(u)
    if not x.query:
        return u
    all_q = urllib.parse.parse_qsl(x.query, keep_blank_values=True)
    q = [(k, v) for k, v in all_q if not k.startswith("utm_") and k not in ("entry", "ref")]
    if len(q) == len(all_q):
        return u
    return urllib.parse.urlunsplit((x.scheme, x.netloc, x.path, urllib.parse.urlencode(q), x.fragment))


def fetch(src):
    name, url, lvl, default, need_kw = src[:5]
    cap = src[5] if len(src) > 5 else MAX_PER_SOURCE
    must = re.compile(src[6], re.I) if len(src) > 6 else None
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
        if must and not must.search(title):
            continue
        if name.startswith("X · ") and (title.startswith(("RT ", "@", "Replying")) or len(title) < 20):  # 转推、回复、太短的推文
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
        link = clean_link(link)
        d = min(d, datetime.now(timezone.utc))  # 个别源站把发布时间写成未来，压到现在
        item = {"d": d.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d"),
                "src": name, "lvl": lvl, "k": ks, "t": title[:160], "u": link}
        if name.startswith(("公众号 · ", "X · ", "BestBlogs")):
            item["via"] = "BestBlogs" if name.startswith("BestBlogs") else "wechat2rss" if name.startswith("公众号") else "xgo.ing"
        if summ and name.startswith(("BestBlogs", "公众号 · ")):
            item["s"] = re.sub(r"^📌\s*One-Sentence Summary\s*", "", summ)[:120]
        items.append(item)
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


# AI 资讯日报（hex2077.dev，何夕2077）：每天一页的聚合日报。它是二手来源，所以每条的可信度按它引用的原始链接的域名算，
# 并标注“经 AI 资讯日报”。只存标题、原始链接和一句摘要。
DAILY_BASE = "https://hex2077.dev/zh-CN/docs/{ym}/{ymd}/"
DAILY_RSS = "https://hex2077.dev/rss.xml"
DAILY_DAYS = 3   # 收最近 3 期；日报偶尔延迟或周末停更，最多往前找 7 天
DOMAIN_A = ("openai.com", "anthropic.com", "claude.com", "deepmind.google", "blog.google", "ai.google.dev", "googleblog.com", "ai.meta.com",
            "about.fb.com", "microsoft.com", "nvidia.com", "huggingface.co", "arxiv.org", "mistral.ai", "deepseek.com",
            "x.ai", "modelcontextprotocol.io", "apple.com", "amazon.com", "aboutamazon.com", "qwen.ai", "qwenlm.github.io", "alibabacloud.com",
            "moonshot.cn", "kimi.com", "bigmodel.cn", "zhipuai.cn", "minimax.io", "z.ai", "cursor.com", "sec.gov", "csrc.gov.cn")
DOMAIN_B = ("the-decoder.com", "theverge.com", "techcrunch.com", "arstechnica.com", "technologyreview.com", "bloomberg.com", "reuters.com",
            "ft.com", "wsj.com", "cnbc.com", "nytimes.com", "theinformation.com", "wired.com", "venturebeat.com", "axios.com",
            "qbitai.com", "36kr.com", "infoq.cn", "leiphone.com", "jiqizhixin.com", "semianalysis.com", "simonwillison.net",
            "latent.space", "interconnects.ai", "sebastianraschka.com", "theregister.com", "caixin.com", "jiemian.com")


# 官方账号在 X 上的发布算一手（A）；其他个人账号、GitHub 热门项目、Reddit 都算社区（C）
X_OFFICIAL = {"openai", "anthropicai", "claudeai", "googledeepmind", "googleai", "geminiapp", "deepseek_ai", "alibaba_qwen", "kimi_moonshot",
              "zai_org", "minimax__ai", "mistralai", "aiatmeta", "xai", "nvidiaai", "huggingface", "github", "cursor_ai", "openaidevs"}


def domain_level(url):
    u = urllib.parse.urlparse(url)
    if (u.hostname or "").endswith(("x.com", "twitter.com")):
        return "A" if u.path.strip("/").split("/")[0].lower() in X_OFFICIAL else "C"
    host = u.hostname or ""
    host = host[4:] if host.startswith("www.") else host
    hit = lambda ds: any(host == d or host.endswith("." + d) for d in ds)
    return "A" if hit(DOMAIN_A) else "B" if hit(DOMAIN_B) else "C"


class DailyParser(html.parser.HTMLParser):
    """日报页面结构：h3 分节，ol > li > p，p 里 <strong> 是标题，第一个外链是原始来源。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.section, self.in_h3, self.in_li, self.in_strong = "", False, 0, False
        self.cur, self.items = None, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "h3":
            self.in_h3, self.section = True, ""
        elif tag == "li" and self.section:
            self.in_li += 1
            if self.in_li == 1:
                self.cur = {"sec": self.section, "title": "", "text": "", "url": ""}
        elif self.cur is not None:
            if tag == "strong" and not self.cur["title"]:
                self.in_strong = True
            elif tag == "a" and not self.cur["url"]:
                href = a.get("href") or ""
                if href.startswith(("http://", "https://")) and "hex2077.dev" not in href:
                    self.cur["url"] = href

    def handle_endtag(self, tag):
        if tag == "h3":
            self.in_h3 = False
        elif tag == "strong":
            self.in_strong = False
        elif tag == "li" and self.in_li:
            self.in_li -= 1
            if not self.in_li and self.cur:
                self.items.append(self.cur)
                self.cur = None
        elif tag == "h2":
            self.section = ""  # 第二个 h2 之后是“多渠道”说明，不是资讯

    def handle_data(self, data):
        if self.in_h3:
            self.section += data.strip()
        elif self.cur is not None:
            if self.in_strong and not self.cur["text"].strip():
                self.cur["title"] += data
            else:
                self.cur["text"] += data


def classify(blob):
    ks = [k for k, r in KW.items() if r.search(blob)]
    if "quant" in ks and not QUANT_STRICT.search(blob):
        ks.remove("quant")
    return ks or ["llm"]  # 日报本身全是 AI 资讯，没命中细分方向的归到大模型


def fetch_ai_daily():
    """返回 (items, 状态说明)。抓最近几天的日报页面 + 周报 RSS。"""
    tz8 = timezone(timedelta(hours=8))
    today = datetime.now(tz8).date()
    items, got, errs = [], 0, []
    for i in range(7):
        if got >= DAILY_DAYS:
            break
        d = today - timedelta(days=i)
        url = DAILY_BASE.format(ym=d.strftime("%Y-%m"), ymd=d.isoformat())
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                raw = r.read().decode("utf-8", "replace")
        except Exception:  # 当天的日报可能还没发布
            continue
        p = DailyParser()
        p.feed(raw)
        got += 1
        for x in p.items:
            title = re.sub(r"\s+", " ", x["title"]).strip().rstrip("。.")
            if not title or not x["url"]:
                continue
            summ = re.sub(r"\s+", " ", x["text"]).strip()
            summ = summ[:120] + ("…" if len(summ) > 120 else "")
            ks = classify(f"{title} {summ}")
            if not ks:
                continue
            items.append({"d": d.isoformat(), "src": f"AI 资讯日报 · {x['sec']}", "lvl": domain_level(x["url"]), "k": ks,
                          "t": title[:160], "s": summ, "u": x["url"], "via": "AI 资讯日报"})
    try:  # 周报：整篇作为一条，属于聚合解读（C 级）
        with urllib.request.urlopen(urllib.request.Request(DAILY_RSS, headers=UA), timeout=30) as r:
            for title, link, d, summ in parse_feed(r.read())[:2]:
                if d and d > datetime.now(timezone.utc) - timedelta(days=14):
                    items.append({"d": d.astimezone(tz8).strftime("%Y-%m-%d"), "src": "AI 深度信号周报", "lvl": "C",
                                  "k": classify(f"{title} {summ}") or ["llm"], "t": title[:160], "s": summ[:120], "u": link})
    except Exception as e:
        errs.append(f"周报 {type(e).__name__}")
    note = f"{'成功' if got else '失败'} AI 资讯日报: {got} 天 {len(items)} 条" + (f"（{'；'.join(errs)}）" if errs else "")
    return items, note


# 交易所公告（A 级一手）：没有 RSS，解析列表页。只收和交易规则、程序化交易、业务指引相关的，跳过逐只债券/基金的日常通知。
SSE_RX = re.compile(r'<span>\s*(\d{4}-\d{2}-\d{2})\s*</span>\s*<a href="([^"]+)" title="([^"]+)"', re.S)
SZSE_RX = re.compile(r"var curHref = '\./([^']+)';.*?var curTitle ='([^']+)';.*?<span class=\"time\">\s*(\d{4}-\d{2}-\d{2})", re.S)
# (名称, 列表页, 链接基准, 正则, (日期, 链接, 标题) 分组序号, 只收命中这个正则的标题；None = 全收)
EX_KEEP = re.compile(r"规则|细则|指引|办法|程序化|量化|交易机制|涨跌幅|融资融券|做市|收费|休市|投资者|异常交易|监管|ETF|改革|新规|征求意见", re.I)
EXCHANGES = [
    ("上交所业务规则", "https://www.sse.com.cn/lawandrules/sselawsrules/latest/", "https://www.sse.com.cn", SSE_RX, (0, 1, 2), None),
    ("上交所要闻", "https://www.sse.com.cn/aboutus/mediacenter/hotandd/", "https://www.sse.com.cn", SSE_RX, (0, 1, 2), EX_KEEP),
    ("深交所要闻", "https://www.szse.cn/aboutus/trends/news/index.html", "https://www.szse.cn/aboutus/trends/news/", SZSE_RX, (2, 0, 1), EX_KEEP),
    ("深交所公告", "https://www.szse.cn/disclosure/notice/index.html", "https://www.szse.cn/disclosure/notice/", SZSE_RX, (2, 0, 1),
     re.compile(r"规则|细则|指引|程序化|交易机制|休市|收费|异常交易|融资融券")),
]


def fetch_exchanges():
    out = []
    for name, url, base, rx, (di, ui, ti), keep in EXCHANGES:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                raw = r.read().decode("utf-8", "replace")
        except Exception as e:
            out.append((name, [], f"{type(e).__name__}: {e}"))
            continue
        cutoff = (datetime.now(timezone(timedelta(hours=8))) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
        its = []
        for m in rx.finditer(raw):
            d, u, t = m.group(di + 1), m.group(ui + 1), html.unescape(m.group(ti + 1)).strip()
            if d < cutoff or (keep and not keep.search(t)) or re.search(r"专项债券|公司债券|提供(一般|主)做市服务|在深交所上市$|在上交所上市$", t):
                continue
            its.append({"d": d, "src": name, "lvl": "A", "k": ["quant"], "t": t[:160], "u": urllib.parse.urljoin(base, u)})
        out.append((name, its[:10], None))
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
    results += fetch_exchanges()
    daily, note = fetch_ai_daily()
    results.append(("AI 资讯日报", daily, None if daily else "没有抓到"))
    for name, its, err in results:
        report.append(note if name == "AI 资讯日报" else f"{'失败' if err else '成功'} {name}: {len(its)} 条" + (f"（{err}）" if err else ""))
        for x in its:
            key = x["u"].split("?")[0].rstrip("/")
            if key not in seen:
                seen.add(key)
                items.append(x)
    items.sort(key=lambda x: x["d"], reverse=True)
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    names = [{"name": s[0], "lvl": s[2]} for s in SOURCES] + [{"name": "AI 资讯日报（何夕2077，按原始链接定级）", "lvl": "B"}] + [{"name": e[0], "lvl": "A"} for e in EXCHANGES]
    data = {"updated": now, "sources": names, "status": report, "items": items, "hf": fetch_hf_daily()}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"已写入 {OUT}，共 {len(items)} 条，更新时间 {now}")
    print("\n".join(report))
    ok = sum(1 for _, _, e in results if not e)
    sys.exit(0 if ok >= len(results) // 2 else 1)


if __name__ == "__main__":
    main()
