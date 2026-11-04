#!/usr/bin/env python3
"""把还没有英文的内容翻译好，写进 src/i18n-en.json（网页切到 English 时用）。
覆盖：理论路线、前沿路线、商机、精选资讯、知识树分类、界面文字里新出现的中文。
用的是每周任务同一套模型配置（MODELSCOPE_KEY 等，或公司电脑的 ~/.config/learning-hub/llm.env）；没有模型时什么都不做。
只用标准库。用法：python3 tools/translate.py [--dry-run]
"""
import glob
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from weekly import make_llm, load_env_file, loose_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "i18n-en.json"
CJK = re.compile(r"[㐀-鿿]")
norm = lambda s: re.sub(r"\s+", " ", s).strip()


def content_strings():
    out = []
    add = lambda s: out.append(norm(s)) if isinstance(s, str) and CJK.search(s) else None
    for f in sorted(glob.glob(str(ROOT / "content" / "tracks" / "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for k in ("name", "short", "goal", "note"):
            add(d.get(k))
        for s in d["stages"]:
            for k in ("title", "goal", "output"):
                add(s.get(k))
            for i in s["items"]:
                add(i["text"])
            for r in s.get("resources", []):
                add(r.get("name"))
    for x in json.load(open(ROOT / "content" / "routes.json", encoding="utf-8"))["routes"]:
        add(x.get("title")); add(x.get("desc"))
        for i in x.get("learn", []):
            add(i.get("text"))
    for x in json.load(open(ROOT / "content" / "biz.json", encoding="utf-8"))["items"]:
        add(x["title"]); add(x["desc"])
        for l in x.get("links", []):
            add(l.get("name"))
    for x in json.load(open(ROOT / "content" / "feed.json", encoding="utf-8"))["items"]:
        add(x["t"]); add(x.get("s")); add(x.get("src"))
    sug = ROOT / "content" / "suggestions.json"
    if sug.exists():
        for x in json.load(open(sug, encoding="utf-8")).get("items", []):
            add(x.get("title")); add(x.get("why"))
            for op in x.get("ops", []):
                add(op.get("text")); add(op.get("why"))
    for d in json.load(open(ROOT / "content" / "domains.json", encoding="utf-8")):
        add(d["name"]); add(d["lede"])
    return list(dict.fromkeys(out))


SYS = ("Translate each Chinese string into concise, natural English for an AI and quant learning site. "
       "Keep official English names of models, companies and products (通义千问 = Qwen, 月之暗面 = Moonshot AI, 证监会 = CSRC). "
       "`{}` is a placeholder: keep the same number of `{}` in the same order. Keep Markdown, numbers and URLs. Do not add facts. "
       "Terms: 前沿路线 = frontier route, 理论路线 = core route, 阶段 = stage, 方向 = track, 学习 Agent = Learning Agent. "
       "Return one JSON object mapping each input string exactly to its translation.")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    load_env_file()
    have = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [s for s in content_strings() if s not in have]
    print(f"需要翻译 {len(todo)} 条")
    if not todo:
        return 0
    llm, why = make_llm()
    if not llm:
        print("跳过翻译：" + why)
        return 0
    done = 0
    for i in range(0, len(todo), 40):
        batch = todo[i:i + 40]
        try:
            res = llm.ask_json(SYS, json.dumps(batch, ensure_ascii=False), 6000) or {}
        except Exception as e:
            print(f"第 {i // 40 + 1} 批失败：{e}")
            continue
        for k in batch:
            v = res.get(k) if isinstance(res, dict) else None
            if isinstance(v, str) and v.strip() and v.count("{}") == k.count("{}") and not CJK.search(v):
                have[k] = v.strip(); done += 1
    print(f"翻译了 {done} 条")
    if "--dry-run" not in sys.argv:
        OUT.write_text(json.dumps(have, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
