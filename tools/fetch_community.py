#!/usr/bin/env python3
"""抓取社区讨论（Reddit 每周高票帖、Hacker News 高分帖），写入 data/community.js 并提交进仓库。

由 AI 助手在每周资讯更新时、在个人电脑上运行（Reddit 经常拦截云服务器的 IP，个人网络更稳）。
只用标准库。用法：python3 tools/fetch_community.py（Windows 上用 python 或 py）
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_sources import KW, AI_RE, fetch_reddit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "community.js"
CST = timezone(timedelta(hours=8))

AGENT_AI = re.compile(r"\bAI\b|LLM|GPT|Claude|Gemini|OpenAI|Anthropic|\bMCP\b|agentic|coding agent|Codex|Copilot|model", re.I)

# Hacker News 每个板块的标题关键词（Algolia 官方搜索接口，稳定、无需登录）
HN = {
    "llm": ["LLM", "GPT", "Claude", "Gemini", "DeepSeek", "Qwen", "language model"],
    "slm": ["small model", "local LLM", "llama.cpp", "Ollama", "fine-tuning", "on-device"],
    "agent": ["AI agent", "agents", "MCP", "agentic", "Claude Code", "Codex"],
    "quant": ["algorithmic trading", "quantitative", "hedge fund", "backtest", "stock market"],
}


def fetch_hn():
    since = int(time.time()) - 7 * 86400
    items, seen = [], set()
    for k, qs in HN.items():
        for q in qs:
            url = ("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=15&restrictSearchableAttributes=title"
                   "&typoTolerance=false&numericFilters=" + urllib.parse.quote(f"points>100,created_at_i>{since}")
                   + "&query=" + urllib.parse.quote(q))
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "learning-hub"}), timeout=20) as r:
                    hits = json.loads(r.read())["hits"]
            except Exception:
                continue
            for h in hits:
                title = h.get("title") or ""
                if h["objectID"] in seen or (k == "quant" and "quantum" in title.lower()):
                    continue
                # “agent”在 HN 上常指其他意思（如执法人员），要求标题同时和 AI 相关
                if k == "agent" and not AGENT_AI.search(title):
                    continue
                seen.add(h["objectID"])
                d = datetime.fromtimestamp(h["created_at_i"], CST).strftime("%Y-%m-%d")
                items.append({"d": d, "src": "Hacker News 高分", "lvl": "C", "k": [k], "t": title[:160],
                              "u": h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
                              "n": h.get("points", 0)})
    items.sort(key=lambda x: -x["n"])
    return items[:40]


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    report, items = [], []
    for name, its, err in fetch_reddit():
        report.append(f"{'失败' if err else '成功'} {name}: {len(its)} 条" + (f"（{err}）" if err else ""))
        # 综合版块里混着与 AI 无关的帖子，按标题再筛一次
        items += [x for x in its if "量化" in name or AI_RE.search(x["t"]) or any(r.search(x["t"]) for r in KW.values())]
    hn = fetch_hn()
    report.append(f"{'成功' if hn else '失败'} Hacker News 高分: {len(hn)} 条")
    items += hn
    if not items:
        print("\n".join(report))
        print("没有抓到任何社区内容，保留旧的 data/community.js")
        sys.exit(1)
    items.sort(key=lambda x: x["d"], reverse=True)
    now = datetime.now(CST).strftime("%Y-%m-%d %H:%M")
    OUT.write_text("/* 由 tools/fetch_community.py 生成（每周资讯更新时运行），请勿手改 */\nHUB.community = "
                   + json.dumps({"updated": now, "status": report, "items": items}, ensure_ascii=False, indent=0)
                   + ";\n", encoding="utf-8")
    print(f"已写入 {OUT}，共 {len(items)} 条，更新时间 {now}")
    print("\n".join(report))


if __name__ == "__main__":
    main()
