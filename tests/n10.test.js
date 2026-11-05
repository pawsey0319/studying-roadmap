// 资讯渠道：校验、网址检查、订阅源解析
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelOk, offKey, checkUrl, parseFeed, feedLinkFromHtml, httpReason, looksHtml } from '../src/core/channels.js';
import { DOCS, DOC_NAMES } from '../src/core/schema.js';

test('渠道文档：自己加的和关掉的内置渠道', () => {
  assert.ok(DOC_NAMES.includes('channels'));
  assert.ok(DOCS.channels('uabc123x', { name: '某博客', url: 'https://a.com/feed', tracks: ['agent'], c: 1 }));
  assert.ok(!DOCS.channels('uabc123x', { name: '某博客', url: 'http://a.com/feed', tracks: [], c: 1 }), '必须是 https');
  assert.ok(!channelOk('uabc123x', { name: '', url: 'https://a.com/f', tracks: [], c: 1 }));
  assert.ok(channelOk(offKey('人人都是产品经理'), '人人都是产品经理'));
  assert.ok(!channelOk('off.zz', 'x'));
  assert.equal(offKey('a'), offKey('a')); assert.notEqual(offKey('a'), offKey('b'));
});

test('网址检查：说清楚是哪一类原因', () => {
  assert.equal(checkUrl('https://example.com/feed'), null);
  assert.equal(checkUrl('不是网址').code, 'bad-url');
  assert.equal(checkUrl('http://example.com/feed').code, 'not-https');
  assert.equal(checkUrl('https://x.com/elonmusk').code, 'x-site');
  assert.equal(checkUrl('https://twitter.com/openai').code, 'x-site');
  assert.equal(checkUrl('https://mp.weixin.qq.com/s/abc').code, 'wechat');
  assert.equal(checkUrl('https://www.weibo.com/u/1').code, 'login-site');
  assert.equal(checkUrl('https://192.168.1.2/feed').code, 'private');
  assert.match(checkUrl('https://x.com/a').message, /付费/);
  assert.match(httpReason(403).message, /登录或付费/);
  assert.match(httpReason(404).message, /不存在/);
  assert.equal(httpReason(503).code, 'http-503');
});

test('解析 RSS、Atom、JSON Feed', () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>我的博客</title><item><title><![CDATA[第一篇 &amp; 其他]]></title><link>https://a.com/1</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;摘要 &lt;b&gt;内容&lt;/b&gt;&lt;/p&gt;</description></item><item><title>没有链接</title></item><item><title>相对链接</title><link>/p/2</link></item></channel></rss>`;
  const r = parseFeed(rss, { base: 'https://a.com/feed' });
  assert.equal(r.title, '我的博客'); assert.equal(r.items.length, 2);
  assert.equal(r.items[0].t, '第一篇 & 其他'); assert.equal(r.items[0].d, '2026-11-03'); assert.equal(r.items[0].s, '摘要 内容');
  assert.equal(r.items[1].u, 'https://a.com/p/2');
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><title>条目</title><link rel="self" href="https://a.com/self"/><link rel="alternate" href="https://a.com/e1"/><updated>2026-11-01T08:00:00Z</updated><summary>简介</summary></entry></feed>`;
  const a = parseFeed(atom); assert.equal(a.items[0].u, 'https://a.com/e1'); assert.equal(a.items[0].d, '2026-11-01');
  const j = parseFeed(JSON.stringify({ title: 'J', items: [{ title: 'x', url: 'https://j.com/1', date_published: '2026-10-30T00:00:00Z', summary: 's' }] }));
  assert.equal(j.items[0].d, '2026-10-30');
  assert.throws(() => parseFeed('<html><body>hi</body></html>'), e => e.code === 'not-feed');
  assert.equal(parseFeed('<rss><channel><title>空</title></channel></rss>').items.length, 0);
});

test('从网页里找订阅链接', () => {
  const html = '<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml"><link rel="stylesheet" href="a.css"></head></html>';
  assert.equal(feedLinkFromHtml(html, 'https://a.com/blog/'), 'https://a.com/feed.xml');
  assert.equal(feedLinkFromHtml('<html></html>', 'https://a.com/'), '');
  assert.ok(looksHtml('<!DOCTYPE html><html>'));
});
