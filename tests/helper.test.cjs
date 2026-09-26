const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const { installNativeFixture } = require('./native-fixture.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../bilistream-intimacy.user.js'), 'utf8');
function setup(t, options = {}) {
  const dom = new JSDOM('<div id="chat-control-panel-vm"><textarea></textarea></div>', {
    url: 'https://live.bilibili.com/123', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.Response = Response; w.Request = Request;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fixture = installNativeFixture(w, options);
  let randomIndex = 0;
  w.Math.random = () => (randomIndex++ % 10) / 10;
  const originalFetch = w.fetch;
  w.eval(source);
  const ui = w.document.getElementById('bilistream-helper').shadowRoot;
  t.after(() => { clock.uninstall(); w.close(); });
  return { ...fixture, w, clock, ui, originalFetch,
    click: id => ui.getElementById(id).click(),
    status: () => ui.getElementById('status').textContent,
    count: id => Number(ui.getElementById(id).textContent),
  };
}
test('native flow confirms 10 messages and 300 reported likes, grouped by 30, without DOM actions', async t => {
  const s = setup(t);
  await s.clock.tickAsync(1000);
  assert.equal(s.messages.length + s.likes.length, 0);
  s.click('start'); await s.clock.tickAsync(180000);
  assert.deepEqual(s.messages.map(m => m.value), ['1','2','3','4','5','6','7','8','9','10']);
  assert.deepEqual(s.messages.map(m => m.likesBefore), [0,30,60,90,120,150,180,210,240,270]);
  assert.equal(s.likes.length, 300);
  for (let i = 1; i < 300; i++) assert.ok(s.likes[i].at - s.likes[i - 1].at >= 375);
  assert.equal(s.count('message-count'), 10);
  assert.equal(s.count('reported-count'), 300);
  assert.equal(s.vm.localSingleReportIntervalLikeNum, 0);
  assert.deepEqual(s.domEvents, []);
  assert.equal(s.w.fetch, s.originalFetch);
  assert.match(s.status(), /执行完毕/);
});
test('waits for actual send callback, not the native method promise', async t => {
  const s = setup(t, { sendDelay: 4000 });
  s.click('start'); await s.clock.tickAsync(2000);
  assert.equal(s.messages.length, 1);
  assert.equal(s.likes.length, 0);
  assert.equal(s.count('message-count'), 0);
  await s.clock.tickAsync(2100);
  assert.equal(s.count('message-count'), 1);
  assert.ok(s.likes.length > 0);
});
test('missing send callback times out without retry or likes', async t => {
  const s = setup(t, { noSendAck: true });
  s.click('start'); await s.clock.tickAsync(30000);
  assert.equal(s.messages.length, 1);
  assert.equal(s.likes.length, 0);
  assert.equal(s.count('message-count'), 0);
  assert.match(s.status(), /超时/);
});
test('rejects an existing draft without clearing or sending it', async t => {
  const s = setup(t, { draft: '我的草稿' });
  s.click('start'); await s.clock.tickAsync(1000);
  assert.equal(s.vm.chatInput, '我的草稿');
  assert.equal(s.input.value, '我的草稿');
  assert.equal(s.messages.length, 0);
  assert.match(s.status(), /草稿/);
});
test('checks login without opening native login UI', async t => {
  const s = setup(t); s.vm.isLogin = false;
  s.click('start'); await s.clock.tickAsync(1000);
  assert.equal(s.messages.length + s.likes.length, 0);
  assert.match(s.status(), /登录/);
});
test('no supported native component fails safely without DOM fallback', async t => {
  const s = setup(t); delete s.w.document.getElementById('chat-control-panel-vm').__vue__;
  s.click('start'); await s.clock.tickAsync(1000);
  assert.equal(s.messages.length + s.likes.length, 0);
  assert.match(s.status(), /内置/);
});
test('native ignored click is not counted or automatically retried', async t => {
  const s = setup(t, { ignoreLike: true });
  s.click('likes-only'); await s.clock.tickAsync(5000);
  assert.equal(s.count('like-count'), 0);
  assert.match(s.status(), /未接收/);
});
test('report rejection stops work and never counts it as confirmed', async t => {
  const s = setup(t, { reportCode: 10030 });
  s.click('start'); await s.clock.tickAsync(20000);
  assert.equal(s.messages.length, 1);
  assert.ok(s.likes.length <= 15);
  assert.equal(s.count('reported-count'), 0);
  assert.match(s.status(), /频繁/);
});
test('recognizes actual native POST reports with fields in the URL query and empty body', async t => {
  const s = setup(t, { reportInQuery: true });
  s.click('likes-only'); await s.clock.tickAsync(6500);
  assert.ok(s.count('reported-count') >= 15);
});
test('network failure stops without retrying report', async t => {
  const s = setup(t, { networkError: true });
  s.click('likes-only'); await s.clock.tickAsync(20000);
  assert.equal(s.reports.length, 1);
  assert.equal(s.count('reported-count'), 0);
  assert.match(s.status(), /上报/);
});
test('stopping while send is pending ignores late callback and blocks ambiguous restart', async t => {
  const s = setup(t, { sendDelay: 5000 });
  s.click('start'); await s.clock.tickAsync(500); s.click('stop');
  await s.clock.tickAsync(6000); s.click('start'); await s.clock.tickAsync(1000);
  assert.equal(s.messages.length, 1);
  assert.equal(s.likes.length, 0);
  assert.equal(s.count('message-count'), 0);
  assert.match(s.status(), /刷新/);
});
test('respects slower cooldown and preserves focus/draft in likes-only mode', async t => {
  const s = setup(t, { cooldown: 0.8, draft: '保留' });
  s.input.focus(); s.click('likes-only'); await s.clock.tickAsync(360000);
  assert.equal(s.likes.length, 300);
  for (let i = 1; i < 300; i++) assert.ok(s.likes[i].at - s.likes[i - 1].at >= 825);
  assert.equal(s.w.document.activeElement, s.input);
  assert.equal(s.vm.chatInput, '保留');
  assert.equal(s.count('reported-count'), 300);
});
test('danmaku-only mode maintains 2-second spacing and never likes', async t => {
  const s = setup(t);
  s.click('danmaku-only'); await s.clock.tickAsync(30000);
  assert.equal(s.messages.length, 10);
  for (let i = 1; i < 10; i++) assert.ok(s.messages[i].at - s.messages[i - 1].at >= 2000);
  assert.equal(s.likes.length, 0);
});
test('hidden page keeps sending and liking, while room navigation still stops further actions', async t => {
  const s = setup(t);
  Object.defineProperty(s.w.document, 'hidden', { configurable: true, value: true });
  s.click('start'); await s.clock.tickAsync(20000);
  assert.ok(s.messages.length >= 2);
  assert.ok(s.likes.length >= 30);
  const before = s.likes.length;
  const messagesBefore = s.messages.length;
  s.w.history.pushState({}, '', '/456'); await s.clock.tickAsync(10000);
  assert.equal(s.likes.length, before);
  assert.equal(s.messages.length, messagesBefore);
  assert.match(s.status(), /房间/);
});
test('background delayed acknowledgement can exceed foreground timeout without resending', async t => {
  const s = setup(t, { sendDelay: 45000 });
  Object.defineProperty(s.w.document, 'hidden', { configurable: true, value: true });
  s.click('start'); await s.clock.tickAsync(25000);
  assert.equal(s.messages.length, 1);
  assert.equal(s.count('message-count'), 0);
  assert.doesNotMatch(s.status(), /超时/);
  await s.clock.tickAsync(21000);
  assert.equal(s.count('message-count'), 1);
  assert.ok(s.likes.length > 0);
});
test('background missing acknowledgement still has a bounded timeout and never retries', async t => {
  const s = setup(t, { noSendAck: true });
  Object.defineProperty(s.w.document, 'hidden', { configurable: true, value: true });
  s.click('start'); await s.clock.tickAsync(1);
  // Model a long gap in timer execution without running thousands of polls.
  s.clock.setSystemTime(181000);
  await s.clock.tickAsync(100);
  assert.equal(s.messages.length, 1);
  assert.equal(s.likes.length, 0);
  assert.match(s.status(), /超时/);
});
test('waits for final queued likes to be reported before completion', async t => {
  const s = setup(t, { reportLimit: 1000 });
  s.click('likes-only');
  for (let i = 0; i < 1800 && s.likes.length < 300; i++) await s.clock.tickAsync(100);
  assert.equal(s.likes.length, 300);
  assert.doesNotMatch(s.status(), /执行完毕/);
  await s.clock.tickAsync(10000);
  assert.equal(s.count('reported-count'), 300);
  assert.match(s.status(), /执行完毕/);
});
