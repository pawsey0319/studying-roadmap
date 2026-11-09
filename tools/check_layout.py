#!/usr/bin/env python3
"""手机和电脑宽度下的溢出检查：每个页面不能有横向滚动条，可见元素的右边界不能超出屏幕。
需要：pip install playwright && python3 -m playwright install chromium
用法（仓库根目录）：python3 tools/check_layout.py      全部通过时退出码为 0
"""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright

PORT = 8799
PAGES = ['#/', '#/t/agent', '#/t/agent/frontier', '#/t/agent/tree', '#/t/agent/news', '#/t/agent/biz', '#/notes', '#/search',
         '#/me', '#/settings', '#/method', '#/library', '#/import', '#/public', '#/legal/privacy', '#/legal/terms']
WIDTHS = (360, 390, 430, 1280)
# 本来就允许横向滑动的容器（标签行、横滑卡片、知识树、代码块、底部导航）里面的元素不算
SKIP = '[hidden],dialog:not([open]),.hstrip,.ttabs,.live,.chips,.hseg,.dtabs,.tr-wrap,pre,.mnav'
JS = """skip => { const vw = innerWidth, bad = [];
  for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || el.closest(skip)) continue;
    if (r.right > vw + 1) bad.push((el.className || el.tagName) + ' ' + Math.round(r.right)); }
  return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 5) }; }"""

def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    fails = 0
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w in WIDTHS:
                ctx = b.new_context(viewport={'width': w, 'height': 800})
                pg = ctx.new_page()
                for h in PAGES:
                    pg.goto(f'http://localhost:{PORT}/{h}'); pg.wait_for_timeout(700)
                    pg.evaluate("document.querySelector('#obDlg')?.open && document.querySelector('#obDlg').close()")
                    r = pg.evaluate(JS, SKIP)
                    ok = r['sw'] <= r['vw'] and not r['bad']
                    fails += not ok
                    print('OK  ' if ok else 'FAIL', w, h, '' if ok else json.dumps(r, ensure_ascii=False))
                ctx.close()
            b.close()
    finally:
        srv.terminate()
    print('全部通过' if not fails else f'{fails} 处溢出')
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
