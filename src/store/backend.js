// 后端适配层：界面和同步逻辑只认这里的接口，不关心背后是腾讯云开发 CloudBase 还是 Supabase。
// 两家都是 PostgreSQL + PostgREST 风格的 REST 接口，差别只在地址、登录流程、令牌刷新。
// config.json：
//   CloudBase：{ "backend": "cloudbase", "cloudbaseEnv": "环境 ID", "cloudbaseKey": "Publishable Key" }
//   Supabase： { "backend": "supabase", "supabaseUrl": "https://xxx.supabase.co", "supabaseAnonKey": "..." }
// 两套都写时以 backend 字段为准；不写 backend 时有 cloudbaseEnv 就用 CloudBase。

async function http(url, opt = {}) {
  const r = await fetch(url, opt);
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) {
    const m = (j && (j.error_description || j.message || j.msg || j.error)) || text || r.status;
    const e = new Error(String(m).replace(/%!\(EXTRA[\s\S]*$/, '').trim()); e.status = r.status; e.code = j && (j.code || j.error); throw e;
  }
  const d = r.headers.get('date');
  return { data: j, serverTime: d ? Date.parse(d) : NaN, headers: r.headers };
}
const jwtSub = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (e) { return ''; } };

/* ---------- 腾讯云开发 CloudBase（PostgreSQL 模式） ---------- */
function cloudbase(env, key) {
  const base = `https://${env}.api.tcloudbasegateway.com`;
  let device = '';
  try { device = localStorage.getItem('learning-hub.device') || ''; } catch (e) {}
  if (device.length < 16) { device = 'lh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); try { localStorage.setItem('learning-hub.device', device); } catch (e) {} }
  const hd = extra => ({ 'content-type': 'application/json', 'x-device-id': device, ...extra });
  const auth = (path, body, token) => http(`${base}/auth/v1${path}${path.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(env)}`,
    { method: body ? 'POST' : 'GET', headers: hd(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { body: JSON.stringify(body) } : {}) });
  const session = (c, email) => ({ access: c.access_token, refresh: c.refresh_token, exp: Date.now() + (c.expires_in || 7200) * 1000, uid: c.sub || jwtSub(c.access_token), email });
  return {
    kind: 'cloudbase', label: '腾讯云开发', versioned: true, publicArea: true,
    rest: base + '/v1/rdb/rest',
    restHeaders: access => hd({ authorization: 'Bearer ' + (access || key) }),
    // 邮箱验证码：发码 → 校验 → 已有账号登录 / 新账号注册（CloudBase 自带邮件代发）
    async sendCode(email) {
      const { data } = await auth('/verification', { email }).catch(e => { throw new Error('发送失败：' + e.message); });
      return { email, vid: data.verification_id, isUser: !!data.is_user };
    },
    async verify(code, p) {
      if (!p || !p.vid) throw new Error('请先发送验证码');
      const { data: v } = await auth('/verification/verify', { verification_id: p.vid, verification_code: String(code).trim() })
        .catch(e => { throw new Error('验证码不对或已过期：' + e.message); });
      const { data: c } = p.isUser
        ? await auth('/signin', { username: p.email, verification_token: v.verification_token })
        : await auth('/signup', { email: p.email, verification_code: String(code).trim(), verification_token: v.verification_token })
          .catch(async e => { if (/exist|already/i.test(e.message)) return auth('/signin', { username: p.email, verification_token: v.verification_token }); throw e; });
      return session(c, p.email);
    },
    async refresh(s) {
      const { data: c } = await auth('/token', { client_id: env, grant_type: 'refresh_token', refresh_token: s.refresh });
      return { ...s, ...session(c, s.email), uid: s.uid || jwtSub(c.access_token) };
    }
  };
}

/* ---------- Supabase（原内测方案，保留作备用） ---------- */
function supabase(url, key) {
  const base = url.trim().replace(/\/+$/, '').replace(/\/(rest|auth|functions)\/v1$/, '');
  // 新版 sb_publishable_ 不是 JWT，只放在 apikey 头里；登录后再带用户令牌
  const hd = (token, extra) => ({ apikey: key, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : key.startsWith('sb_') ? {} : { authorization: 'Bearer ' + key }), ...extra });
  const session = j => ({ access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id, email: j.user && j.user.email });
  return {
    kind: 'supabase', label: 'Supabase', versioned: false, publicArea: false, base,
    rest: base + '/rest/v1',
    restHeaders: access => hd(access),
    async sendCode(email) {
      await http(`${base}/auth/v1/otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { method: 'POST', headers: hd(), body: JSON.stringify({ email, create_user: false }) })
        .catch(e => { throw new Error(/signup|not allowed|not found/i.test(e.message) ? '这个邮箱还没有被邀请。需要管理员先在后台邀请。' : '发送失败：' + e.message); });
      return { email };
    },
    async verify(code, p) {
      const { data } = await http(`${base}/auth/v1/verify`, { method: 'POST', headers: hd(), body: JSON.stringify({ type: 'email', email: p.email, token: String(code).trim() }) })
        .catch(e => { throw new Error('验证码不对或已过期：' + e.message); });
      return session(data);
    },
    async refresh(s) {
      const { data } = await http(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: hd(), body: JSON.stringify({ refresh_token: s.refresh }) });
      return { ...s, ...session(data), uid: s.uid, email: s.email };
    },
    async user(access) { const { data } = await http(`${base}/auth/v1/user`, { headers: hd(access) }); return data; }
  };
}

export function makeBackend(cfg) {
  cfg = cfg || {};
  const kind = cfg.backend || (cfg.cloudbaseEnv ? 'cloudbase' : cfg.supabaseUrl ? 'supabase' : '');
  if (kind === 'cloudbase' && cfg.cloudbaseEnv && cfg.cloudbaseKey) return cloudbase(cfg.cloudbaseEnv.trim(), cfg.cloudbaseKey.trim());
  if (kind === 'supabase' && cfg.supabaseUrl && cfg.supabaseAnonKey) return supabase(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return null;
}
export { http };
