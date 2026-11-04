// 安卓 App（Capacitor）专用的几处适配。网页版里这些函数什么都不做或走浏览器的默认做法。
// 插件用 Capacitor 注入的全局对象调用，不需要打包工具。
const C = () => window.Capacitor;
export const isNative = () => !!(C() && C().isNativePlatform && C().isNativePlatform());
const plugin = name => { const c = C(); return c && ((c.Plugins && c.Plugins[name]) || (c.registerPlugin && c.registerPlugin(name))); };

// App 里装的是安装时的网页文件；资讯、路线这些每天/每周更新的内容优先从网站读最新的，读不到再用安装包里的
export const REMOTE = 'https://pawsey0319.github.io/studying-roadmap/';

/* ---------- 保存文件：网页直接下载；App 里写到缓存目录再弹出系统分享（存到文件、发到微信等） ---------- */
export async function saveFile(name, text, mime = 'text/plain') {
  if (!isNative()) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); return;
  }
  const fs = plugin('Filesystem'), share = plugin('Share');
  const r = await fs.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await share.share({ title: name, files: [r.uri] });
}

/* ---------- 外部链接用系统浏览器打开（App 内的网页视图不适合看原文） ---------- */
function externalLinks() {
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    const u = a.href; if (!/^https?:\/\//.test(u) || new URL(u).host === location.host) return;
    e.preventDefault();
    const b = plugin('Browser'); if (b) b.open({ url: u }); else window.open(u, '_system');
  }, true);
}

/* ---------- 返回键：先关弹窗和侧边抽屉，再后退，最后退出 ---------- */
function backButton() {
  const app = plugin('App'); if (!app) return;
  app.addListener('backButton', ({ canGoBack }) => {
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    if (d) { d.close(); return; }
    if (document.body.classList.contains('dw-open')) { document.querySelector('[data-act=agent-close]')?.click(); return; }
    const qn = document.getElementById('qn'); if (qn && !qn.hidden) { document.querySelector('[data-act=qn-close]')?.click(); return; }
    if (location.hash && location.hash !== '#/' && (canGoBack || history.length > 1)) history.back(); else app.exitApp();
  });
  // 回到前台时让页面知道（同步、刷新资讯）
  app.addListener('resume', () => document.dispatchEvent(new Event('visibilitychange')));
}

/* ---------- 每天的学习提醒（本地通知，不经过服务器） ---------- */
// cfg：{ on, hour, minute }；body 是提醒里显示的“今天学什么”
export async function scheduleReminder(cfg, body) {
  const ln = plugin('LocalNotifications'); if (!ln) return '这台设备不支持通知';
  await ln.cancel({ notifications: [{ id: 1 }] }).catch(() => {});
  if (!cfg || !cfg.on) return '';
  let p = await ln.checkPermissions();
  if (p.display !== 'granted') p = await ln.requestPermissions();
  if (p.display !== 'granted') return '没有通知权限：在系统设置 → 应用 → 学习路线 → 通知里打开';
  await ln.schedule({ notifications: [{ id: 1, title: '该学习了', body: String(body || '打开看看今天学什么').slice(0, 120), schedule: { on: { hour: cfg.hour, minute: cfg.minute }, allowWhileIdle: true } }] });
  return '';
}

export function initNative() {
  if (!isNative()) return;
  document.documentElement.classList.add('native');
  externalLinks(); backButton();
  const ln = plugin('LocalNotifications');
  if (ln) ln.addListener('localNotificationActionPerformed', () => { location.hash = '#/'; });
}
