const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const { installNativeFixture } = require('./native-fixture.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../bilistream-intimacy.user.js'), 'utf8');

function setup(t) {
  const dom = new JSDOM('<main>赛事专题页</main>', {
    url: 'https://live.bilibili.com/123', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  w.Response = Response; w.Request = Request;
  const originalFetch = w.fetch = () => { throw new Error('Native reports must use the embedded page transport'); };
  w.eval(source);
  const ui = w.document.getElementById('bilistream-helper').shadowRoot;
  t.after(() => { clock.uninstall(); w.close(); });
  function addFrame(url = 'https://live.bilibili.com/blanc/999?liteVersion=true') {
    const frame = w.document.createElement('iframe');
    frame.src = url; w.document.body.appendChild(frame);
    const child = frame.contentWindow;
    child.document.write('<div id="chat-control-panel-vm"><textarea></textarea></div>');
    child.document.close();
    child.Response = Response; child.Request = Request;
    child.setTimeout = w.setTimeout; child.clearTimeout = w.clearTimeout; child.Date = w.Date;
    const fixture = installNativeFixture(child);
    return { frame, child, ...fixture, originalFetch: child.fetch };
  }
  return { w, clock, ui, addFrame, originalFetch,
    click: id => ui.getElementById(id).click(),
    status: () => ui.getElementById('status').textContent,
    count: id => Number(ui.getElementById(id).textContent),
  };
}

test('embedded live room sends a message and confirms 30 likes before the next message', async t => {
  const s = setup(t);
  const child = s.addFrame();
  s.click('start'); await s.clock.tickAsync(16000);
  assert.ok(child.messages.length >= 2, s.status());
  assert.equal(child.messages[1].likesBefore, 30);
  assert.ok(s.count('reported-count') >= 30, s.status());
  assert.deepEqual(child.domEvents, []);
  assert.equal(s.w.fetch, s.originalFetch);
  s.click('stop'); await s.clock.tickAsync(100);
  assert.equal(child.child.fetch, child.originalFetch);
});

test('detects the embedded component when its frame finishes loading after the helper', async t => {
  const s = setup(t);
  s.click('check-native');
  assert.match(s.status(), /未找到/);
  const child = s.addFrame();
  s.click('check-native');
  assert.match(s.status(), /已识别/);
  assert.equal(child.messages.length + child.likes.length, 0);
  s.click('danmaku-only'); await s.clock.tickAsync(500);
  assert.equal(s.count('message-count'), 1, s.status());
});

test('skips inaccessible and unrelated iframes before finding the live frame', async t => {
  const s = setup(t);
  const foreign = s.w.document.createElement('iframe');
  foreign.src = 'https://example.org/advert'; s.w.document.body.appendChild(foreign);
  Object.defineProperty(foreign, 'contentDocument', { get() { throw new s.w.DOMException('Blocked', 'SecurityError'); } });
  const unrelated = s.addFrame('https://live.bilibili.com/activity/other');
  const child = s.addFrame();
  s.click('danmaku-only'); await s.clock.tickAsync(500);
  assert.equal(child.messages.length, 1, s.status());
  assert.equal(unrelated.messages.length, 0);
});

test('removing an embedded live frame stops subsequent messages', async t => {
  const s = setup(t);
  const child = s.addFrame();
  s.click('danmaku-only'); await s.clock.tickAsync(500);
  assert.equal(child.messages.length, 1, s.status());
  child.frame.remove(); await s.clock.tickAsync(5000);
  assert.equal(child.messages.length, 1);
  assert.equal(s.ui.getElementById('stop').disabled, true);
});

test('stopping restores controls when the embedded window becomes inaccessible', async t => {
  const s = setup(t);
  const child = s.addFrame();
  const originalOpen = child.child.XMLHttpRequest.prototype.open;
  s.click('likes-only'); await s.clock.tickAsync(500);
  assert.ok(child.likes.length > 0);
  // A cross-origin navigation makes existing WindowProxy property reads throw.
  Object.defineProperty(child.child, 'fetch', { configurable: true,
    get() { throw new s.w.DOMException('Blocked cross-origin window', 'SecurityError'); } });
  s.click('stop'); await s.clock.tickAsync(100);
  assert.equal(s.ui.getElementById('start').disabled, false);
  assert.equal(s.ui.getElementById('stop').disabled, true);
  assert.equal(child.child.XMLHttpRequest.prototype.open, originalOpen);
});
