// 学习 Agent 的逻辑部分：上下文、提示词、回复解析、工具。界面在 ui/agentui.js。
// 协议：模型在回复里用代码块输出结构化内容——
//   ```plan  {"stage":"阶段 ID","title":"…","ops":[…]}```          修改方案（你勾选后才写入）
//   ```route {"route":"路线 ID","items":[{"text":"…","mode":"theory|practice","url":"…"}]}```  前沿路线学习清单补充
//   ```note  {"text":"…","at":"阶段 ID"}```                         建议存进笔记
//   ```memory {"text":"…"}```                                        建议记住的长期信息
//   ```summary {...}```                                              开局追问时的路线摘要
//   ```tool {"name":"…","args":{…}}```                               多步模式下调用工具（只读）
//   ```quiz  {"item":"任务 ID","kind":"memory|procedural|concept","q":"题目","a":"参考答案"}```  自测出题（界面只显示题目）
//   ```grade {"item":"任务 ID","score":0.8,"hints":0,"retries":0,"pass":true}```  批改结果（自动记进自测记录）
import { cleanOps } from '../core/overlay.js';

const BLOCK_RE = /```(plan|route|note|memory|summary|tool|track|next|digest|method|quiz|grade)\s*\n?([\s\S]*?)```/g;

// 宽松解析：去掉注释和尾逗号，容忍模型输出的常见小错误
export function looseJSON(s) {
  try { return JSON.parse(s); } catch (e) {}
  const t = String(s).replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '').replace(/\/\/[^\n"]*$/gm, '').replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(t); } catch (e) { return null; }
}

export function extractBlocks(text) {
  const blocks = [];
  const clean = String(text || '').replace(BLOCK_RE, (_, type, body) => {
    const data = looseJSON(body.trim());
    if (data) blocks.push({ type, data });
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, blocks };
}

/* ---------- 上下文 ---------- */
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

export function stageContext(s, t, notes) {
  const lines = [`方向：${t.name}（${t.id}）`, `阶段 ID：${s.id}`, `阶段：${s.title}`, `目标：${s.goal}`,
    `状态：${s.mastered ? '用户标为已掌握' : `${s.prog ? s.prog.n + '/' + s.prog.total : ''} 项完成`}`, '任务（ID｜类型｜状态｜内容）：'];
  for (const i of s.items) lines.push(`- ${i.id}｜${i.mode === 'practice' ? '实践验证' : '理论'}｜${i.skipped ? '已跳过' : i.done ? '已完成' : '未完成'}｜${i.text}`);
  if (s.resources && s.resources.length) lines.push('资源：' + s.resources.map(r => r.name).join('；'));
  if (s.output) lines.push('阶段产出：' + s.output);
  if (notes) lines.push('这个阶段的笔记：\n' + clip(notes, 3500));
  return lines.join('\n');
}

export function systemPrompt({ profile, memory, recent, method, digests, journal, tests }) {
  return [
    '你是一个学习网站里的个人学习 Agent，用中文回答，语气平实、直接，不说客套话。',
    '用户自驱力强，目标是进入一个新领域或在领域里持续深耕；不要督促打卡，要帮他把路线调到最适合他的样子。',
    profile ? `学习者档案：${clip(profile, 2000)}` : '',
    memory ? `你记得的长期信息：${clip(memory, 2000)}` : '',
    recent ? `最近的调整：${clip(recent, 800)}` : '',
    method ? `你观察到的这个用户的学习方式（越靠前越有把握），讲解和出题时照着调整，不要向用户复述这份清单：\n${clip(method, 1500)}` : '',
    digests ? `和这次话题相关的过去对话纪要（只在相关时引用）：\n${clip(digests, 2400)}` : '',
    journal ? `学习日志（上次聊到哪、下次重点），接着上次继续，不要从头讲：\n${clip(journal, 800)}` : '',
    tests ? `这个阶段的自测掌握度（出题时优先考没自测或没达标的任务）：\n${clip(tests, 1200)}` : '',
    '规则：',
    '1. 用户描述模糊时先追问，每次最多 3 个问题，并尽量给出可以直接选的选项；清楚了再给方案。',
    '2. 修改路线时只在现有阶段上裁剪和改写（改目标、新增或改写任务、加资源、建议跳过、建议标为已掌握），不重排阶段。修改方案放在 ```plan``` 代码块里，格式：{"stage":"阶段 ID","title":"一句话标题","ops":[{"op":"goal","text":"新目标","why":"原因"},{"op":"skip","id":"任务 ID","why":"…"},{"op":"add","text":"新任务","mode":"theory 或 practice","why":"…"},{"op":"edit","id":"任务 ID","text":"改写后的内容","why":"…"},{"op":"res","name":"资源名","url":"链接（不确定就留空）","why":"…"},{"op":"mastered","why":"…"}]}。',
    '3. 跳过和标为已掌握只能建议，由用户自己勾选确认。实践验证类任务（动手做、写、搭、跑通）的 mode 写 practice。',
    '4. 不要编造链接。推荐资源时，不确定链接就只写资源名称，url 留空。',
    '5. 建议存进笔记的内容放在 ```note``` 代码块：{"text":"Markdown 内容","at":"阶段 ID"}。值得长期记住的用户信息放在 ```memory``` 代码块：{"text":"…"}。用户确认后才会保存。',
    '6. 工具：只有当前上下文里没有、又确实需要用户自己的数据（其他阶段、笔记、资讯、过去的对话纪要）时才调用；概念解释、一般问题直接回答，不要调用。调用时每次只调一个，格式：```tool\n{"name":"工具名","args":{…}}\n```，然后停下等结果。可用工具：list_tracks{}；get_stage{"id"}；search_news{"query","track"}；get_notes{"at" 或 "query"}；get_route{"id"}；search_digests{"query"}。最多 6 步。',
    '7. 每次回答的最后，附上用户接下来可能想做的 3 件事，放在 ```next``` 代码块：{"q":["…","…","…"]}。用用户的口吻，每条 18 字以内，紧扣刚才讲的内容，不要泛泛的“讲简单点”；其中 1 条是检验理解的（例如“考我一道……的题”“我复述一遍……你看对不对”）。',
    '8. 自测：用户要你考他时，一次只出一道题，放在 ```quiz``` 代码块：{"item":"任务 ID","kind":"memory、procedural 或 concept","q":"题目","a":"参考答案（界面不显示）"}。记忆类问事实和定义，步骤类问怎么做，概念类请用户用自己的话讲一遍。用户作答后先讲评，再输出 ```grade``` 代码块：{"item":"任务 ID","score":0 到 1 的得分,"hints":这道题给过几次提示,"retries":重答了几次,"pass":概念类讲得是否到位（其他类可省略）}。用户要提示时只给提示、不给答案，提示次数会扣分。不要在出题时泄露答案。',
    '回答尽量短，先给结论。'
  ].filter(Boolean).join('\n');
}

export function cleanPlan(data, stage) {
  if (!data || !stage) return null;
  const ops = cleanOps(data.ops, stage);
  return ops.length ? { stage: stage.id, title: String(data.title || '调整这个阶段').slice(0, 80), ops } : null;
}

/* ---------- 开局追问 ---------- */
export const ONBOARD_FIELDS = [
  ['tracks', '想学哪些方向'],
  ['levels', '每个方向现在的程度'],
  ['purpose', '学的目的'],
  ['outputs', '想要的产出'],
  ['ratio', '产品和技术怎么分配'],
  ['materials', '有没有现成的路线或资料']
];
export function onboardPrompt(existing) {
  return [
    '你在帮一个新用户理清学习路线。目标是弄清楚下面 6 项，弄清楚之前不要生成方案：',
    '1) 想学哪些方向（数量由用户定，可以是网站已有的方向，也可以是新方向）；2) 每个方向现在的程度：没接触 / 了解概念 / 动手做过 / 能独立做项目；3) 学的目的：求职、做项目、跟前沿、转行等；4) 想要的产出：作品、论文笔记、面试准备等；5) 产品和技术怎么分配；6) 有没有现成的路线或资料可以导入。',
    `路线库里现成的方向（用户提到时填它的 id）：${existing.map(t => `${t.name}（id: ${t.id}）`).join('、')}。`,
    '每轮：先用一两句话回应用户，再问还没弄清的项，每次最多问 3 个问题，并给出可以直接选的选项（用“· 选项”列出）。',
    '每轮回复的最后，必须输出当前的理解摘要，放在 ```summary``` 代码块里，JSON 格式：',
    '{"tracks":[{"name":"方向名","id":"已有方向的 id，新方向留空","level":"程度","note":"补充，可空"}],"purpose":"…","outputs":"…","ratio":"…","materials":"…","unclear":["还模糊的项的名称"],"ready":false}',
    '只有 6 项都清楚时 ready 才是 true，这时问用户“这样理解对吗？确认后我来生成方案”。没弄清的字段留空字符串。',
    '用中文，简短。'
  ].join('\n');
}
export function summaryStatus(sum) {
  const s = sum || {};
  const has = v => Array.isArray(v) ? v.length > 0 : !!String(v || '').trim();
  return {
    tracks: has(s.tracks),
    levels: has(s.tracks) && s.tracks.every(t => has(t.level)),
    purpose: has(s.purpose), outputs: has(s.outputs), ratio: has(s.ratio), materials: has(s.materials)
  };
}
export function profileFromSummary(sum, extra) {
  const s = sum || {};
  return [
    (s.tracks || []).map(t => `${t.name}：${t.level || '程度未说明'}${t.note ? '，' + t.note : ''}`).join('；'),
    s.purpose && '目的：' + s.purpose, s.outputs && '想要的产出：' + s.outputs, s.ratio && '产品与技术：' + s.ratio,
    s.materials && '已有资料：' + s.materials, extra
  ].filter(Boolean).join('。');
}
// 为已有方向生成方案的提示词
export function planForTrackPrompt(t, stagesText, summary) {
  return `根据用户的情况，为“${t.name}”方向生成个人方案。用户在这个方向：${summary.level || '程度未说明'}${summary.note ? '，' + summary.note : ''}。\n\n` +
    `这个方向的理论阶段如下：\n${stagesText}\n\n` +
    '对需要调整的阶段各输出一个 ```plan``` 代码块（不需要调整的阶段不用输出）。用户已经掌握的阶段用 mastered 建议；部分会的用 skip 建议跳过具体任务；用户目的需要的加 add。最后用两三句话说明整体思路。';
}
// 为新方向起草一条路线
export function draftTrackPrompt(name, summary) {
  return `用户想学一个网站还没有的新方向：“${name}”。用户程度：${summary.level || '未说明'}${summary.note ? '，' + summary.note : ''}。` +
    '请起草一条理论路线，4–6 个阶段，按内容的先后逻辑排列。每个阶段 3–6 个任务，其中至少 1 个实践验证（动手做的任务）。资源只写你确定存在的，不确定链接就留空。' +
    '输出在 ```track``` 代码块里，JSON：{"name":"方向名","goal":"一句话目标","stages":[{"title":"…","goal":"…","items":[{"text":"…","mode":"theory 或 practice"}],"resources":[{"name":"…","url":""}],"output":"阶段产出"}]}';
}

/* ---------- 对话纪要与学习方法档案 ---------- */
// 一段对话结束时（离开超过设定的小时数，或用户点“新话题”），把它压缩成纪要，并对学习方法档案做几处小修改
export function digestPrompt(methodLines) {
  return [
    '你在整理一段学习对话。用中文，只根据对话内容，不要编造。输出两个代码块：',
    '1) ```digest``` 代码块，JSON：{"title":"这段对话在学什么，16 字以内","learned":["用户弄懂了的要点，最多 5 条"],"open":["还没解决的疑问"],"wrong":["出现过的误解 → 正确理解"],"next":"下次重点，一句话"}。没有的项给空数组或空字符串。',
    '2) ```method``` 代码块，JSON：{"ops":[…]}。这是用户的“学习方法档案”：记录他“怎么学”，不是“学了什么”。比如适合先看例子还是先看定义、会不会追问为什么、能不能用自己的话讲回来、做自测的表现、反复出现的误区类型、喜欢的节奏、是不是动手才记得住。',
    '   维度只能从这些里选：呈现偏好、提取练习、自我解释、深加工、元认知、常见误区、节奏、动手偏好、其他。',
    '   操作（id 用下面清单里的编号）：{"op":"add","d":"维度","t":"一句具体的观察","q":"用户的原话"}；{"op":"reinforce","id":编号}（又印证了它）；{"op":"revise","id":编号,"t":"修正后的描述"}；{"op":"weaken","id":编号}（这次表现和它相反）；{"op":"delete","id":编号,"why":"contradicted、superseded、stale 或 low_signal"}。',
    '   规则：最多 3 个操作。只写这次对话里有直接证据的。“呈现偏好、节奏、动手偏好”这三类必须在 q 里一字不差地引用用户说过的一句话，否则会被丢弃。每条 240 字以内，要具体到能指导讲法，例如“先给生活类比再讲公式时理解更快”；不要用“深刻、总是、从不、完全、彻底”这类绝对化的词。和已有条目意思相同就用 reinforce，不要重复新增。',
    '   这次对话看不出什么新东西时，给空数组 {"ops":[]}，这是正常结果。',
    '现有的学习方法档案（编号｜维度｜描述｜把握程度）：',
    methodLines || '（空白，还没有任何条目）'
  ].join('\n');
}
export function digestText(d) {
  const L = (h, xs) => (xs && xs.length ? `**${h}**\n${xs.map(x => '- ' + String(x).slice(0, 300)).join('\n')}\n` : '');
  return [L('弄懂了', d.learned), L('还没解决', d.open), L('误解与纠正', d.wrong), d.next ? `**下一步**：${String(d.next).slice(0, 300)}` : ''].filter(Boolean).join('\n').trim();
}
