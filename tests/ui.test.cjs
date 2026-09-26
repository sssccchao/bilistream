const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { installNativeFixture } = require('./native-fixture.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../bilistream-intimacy.user.js'), 'utf8');
const STORAGE_KEY = 'bilistream.helper.ui.v1';
function setup(t, saved) {
  const dom = new JSDOM('<div id="chat-control-panel-vm"><textarea></textarea></div>', {
    url: 'https://live.bilibili.com/123', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window; w.Response = Response; w.Request = Request;
  const fixture = installNativeFixture(w);
  if (saved !== undefined) w.localStorage.setItem(STORAGE_KEY, saved);
  w.eval(source);
  const host = w.document.getElementById('bilistream-helper');
  const ui = host.shadowRoot;
  t.after(() => w.close());
  return { w, fixture, host, ui, el: id => ui.getElementById(id) };
}
test('tabs reveal their controls without sending or stopping tasks', t => {
  const s = setup(t);
  assert.ok(s.el('tab-tasks'), '应有任务标签页');
  assert.equal(s.el('panel-tasks').hidden, false);
  s.el('tab-emojis').click();
  assert.equal(s.el('panel-tasks').hidden, true);
  assert.equal(s.el('panel-emojis').hidden, false);
  assert.equal(s.el('tab-emojis').getAttribute('aria-selected'), 'true');
  assert.equal(s.el('tab-tasks').tabIndex, -1);
  s.el('tab-settings').click();
  assert.equal(s.el('panel-emojis').hidden, true);
  assert.equal(s.el('panel-settings').hidden, false);
  assert.equal(s.fixture.messages.length + s.fixture.likes.length, 0);
});
test('tab keyboard navigation moves focus and restores the chosen tab after refresh', t => {
  const s = setup(t);
  assert.ok(s.el('tab-tasks'), '应有任务标签页');
  s.el('tab-tasks').focus();
  s.el('tab-tasks').dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(s.ui.activeElement, s.el('tab-emojis'));
  const next = setup(t, s.w.localStorage.getItem(STORAGE_KEY));
  assert.equal(next.el('panel-emojis').hidden, false);
  assert.equal(next.el('tab-emojis').getAttribute('aria-selected'), 'true');
});
test('collapsed launcher state survives refresh and opens the previously chosen panel', t => {
  const s = setup(t);
  assert.ok(s.el('tab-settings'), '应有设置标签页');
  s.el('tab-settings').click(); s.el('collapse').click();
  const next = setup(t, s.w.localStorage.getItem(STORAGE_KEY));
  assert.equal(next.host.hasAttribute('data-collapsed'), true);
  next.el('collapse').click();
  assert.equal(next.host.hasAttribute('data-collapsed'), false);
  assert.equal(next.el('panel-settings').hidden, false);
});
test('resizing clamps the panel, restores page cursor and persists the width', t => {
  const s = setup(t);
  const handle = s.el('resize-handle');
  assert.ok(handle, '应支持拖动调整宽度');
  s.w.document.body.style.cursor = 'crosshair';
  s.w.document.body.style.userSelect = 'text';
  function pointer(target, type, x) {
    const event = new s.w.MouseEvent(type, { clientX: x, button: 0, bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  }
  pointer(handle, 'pointerdown', 320);
  pointer(s.w, 'pointermove', 600);
  pointer(s.w, 'pointerup', 600);
  const saved = s.w.localStorage.getItem(STORAGE_KEY);
  const next = setup(t, saved);
  const width = parseFloat(next.host.style.getPropertyValue('--panel-width'));
  assert.ok(width >= 400 && width <= 560, `拖动后的宽度 ${width} 应在限制内`);
  assert.equal(s.w.document.body.style.cursor, 'crosshair');
  assert.equal(s.w.document.body.style.userSelect, 'text');
});
test('invalid saved preferences do not prevent showing task controls', t => {
  const s = setup(t, '{broken-json');
  assert.ok(s.el('panel-tasks'), '设置损坏时仍应显示任务界面');
  assert.equal(s.el('panel-tasks').hidden, false);
  assert.equal(s.host.hasAttribute('data-collapsed'), false);
});
