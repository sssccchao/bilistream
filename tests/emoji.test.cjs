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
  const w = dom.window; w.Response = Response; w.Request = Request;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fixture = installNativeFixture(w);
  let randomIndex = 0;
  w.Math.random = () => (options.randomSequence || [0])[randomIndex++ % (options.randomSequence || [0]).length];
  w.document.cookie = 'bili_jct=csrf-token';
  const calls = [];
  let reads = 0;
  w.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init, at: w.Date.now(), likes: fixture.likes.length });
    let result;
    if (parsed.pathname.endsWith('/GetEmoticons')) {
      reads++;
      result = { code: 0, data: { fans_brand: 1, data: [
        { pkg_type: 2, pkg_name: '房间专属表情', emoticons: [
          { emoji: '[开心]', emoticon_unique: 'room_999_happy', perm: options.revoke && reads > 1 ? 0 : 1, url: 'http://i0.hdslb.com/happy.png' },
          { emoji: '[舰长]', emoticon_unique: 'room_999_captain', perm: 0, unlock_show_text: '需舰长', url: 'https://i0.hdslb.com/captain.png' },
        ] },
        { pkg_type: 4, pkg_name: 'UP主大表情', emoticons: [{ emoji: '[UP开心]', perm: options.revoke && reads > 1 ? 0 : 1, emoticon_unique: 'up_happy' }] },
        { pkg_type: 1, pkg_name: '通用大表情', emoticons: [{ emoji: '[通用]', perm: 1, emoticon_unique: 'generic_emoji' }] },
        { pkg_type: 2, pkg_name: '活动表情', emoticons: [{ emoji: '[活动]', perm: 1, emoticon_unique: 'event_emoji' }] },
        { pkg_type: 3, pkg_name: '小表情', emoticons: [{ emoji: '[dog]', descript: '[dog]', perm: 1, emoticon_unique: 'emoji_text' }] },
      ] } };
      if (options.otherOnly) result.data.data = result.data.data.filter(pack => ['通用大表情', '活动表情', '小表情'].includes(pack.pkg_name));
    } else if (parsed.pathname === '/x/web-interface/nav') {
      result = { data: { wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } } };
    } else if (parsed.pathname === '/msg/send') {
      if (options.sendDelay) await new Promise(resolve => w.setTimeout(resolve, options.sendDelay));
      if (options.networkError) throw new Error('连接中断，结果未知');
      result = { code: options.reject ? 10030 : 0, message: options.reject ? '表情发送失败' : '' };
    } else if (parsed.pathname.endsWith('/likeReportV3')) result = { code: 0 };
    else throw new Error('Unexpected API: ' + url);
    return new w.Response(JSON.stringify(result), { status: 200 });
  };
  w.eval(source);
  const ui = w.document.getElementById('bilistream-helper').shadowRoot;
  t.after(() => { clock.uninstall(); w.close(); });
  return { w, clock, ui, calls, fixture, status: () => ui.getElementById('status').textContent };
}
async function selectEmoji(s) {
  const load = s.ui.getElementById('load-emojis');
  assert.ok(load, '表情读取按钮应存在');
  load.click(); await s.clock.tickAsync(100);
  const emoji = s.ui.querySelector('[data-emoji="room_999_happy"]');
  assert.ok(emoji, '可用的房间专属表情应可选');
  emoji.click();
}
test('lists room emojis with previews, disables locked ones and excludes inline text packages', async t => {
  const s = setup(t); await selectEmoji(s);
  assert.equal(s.ui.querySelector('[data-emoji="room_999_captain"]').disabled, true);
  assert.equal(s.ui.querySelector('[data-emoji="emoji_text"]'), null);
  assert.equal(s.ui.querySelector('[data-emoji="room_999_happy"] img').src, 'https://i0.hdslb.com/happy.png');
  assert.match(s.ui.getElementById('emoji-summary').textContent, /可用 2/);
  assert.equal(s.calls.filter(c => c.init.method === 'POST').length, 0);
});
test('only displays UP large emojis and room-exclusive emojis regardless of other package types', async t => {
  const s = setup(t); await selectEmoji(s);
  const visible = [...s.ui.querySelectorAll('[data-emoji]')].map(button => button.dataset.emoji);
  assert.deepEqual(visible, ['room_999_happy', 'room_999_captain', 'up_happy']);
});
test('shows an empty state instead of falling back to other emoji categories', async t => {
  const s = setup(t, { otherOnly: true });
  s.ui.getElementById('load-emojis').click(); await s.clock.tickAsync(100);
  assert.equal(s.ui.querySelectorAll('[data-emoji]').length, 0);
  assert.match(s.status(), /暂无/);
  assert.equal(s.ui.getElementById('message-type').value, 'number');
});
test('uses emoji protocol for all ten task messages, with thirty likes after each acknowledgement', async t => {
  const s = setup(t); await selectEmoji(s);
  s.ui.getElementById('start').click(); await s.clock.tickAsync(180000);
  const sends = s.calls.filter(c => c.url.pathname === '/msg/send');
  assert.equal(sends.length, 10);
  for (const c of sends) {
    const body = new URLSearchParams(c.init.body);
    assert.equal(body.get('msg'), 'room_999_happy');
    assert.equal(body.get('dm_type'), '1');
    assert.equal(body.get('roomid'), '999');
    assert.equal(body.get('csrf'), 'csrf-token');
    assert.ok(c.url.searchParams.get('w_rid'));
  }
  assert.deepEqual(sends.map(c => c.likes), [0,30,60,90,120,150,180,210,240,270]);
  assert.equal(s.fixture.messages.length, 0);
  assert.equal(s.fixture.likes.length, 300);
  assert.match(s.status(), /执行完毕/);
});
test('stops before sending when the random emoji pool has no permitted items', async t => {
  const s = setup(t, { revoke: true }); await selectEmoji(s);
  s.ui.getElementById('start').click(); await s.clock.tickAsync(1000);
  assert.equal(s.calls.filter(c => c.init.method === 'POST').length, 0);
  assert.equal(s.fixture.likes.length, 0);
  assert.match(s.status(), /表情.*权限|表情.*不可用|没有可用表情/);
});
test('a rejected emoji send never starts likes or counts the message', async t => {
  const s = setup(t, { reject: true }); await selectEmoji(s);
  s.ui.getElementById('start').click(); await s.clock.tickAsync(1000);
  assert.equal(s.fixture.likes.length, 0);
  assert.equal(s.ui.getElementById('message-count').textContent, '0');
  assert.match(s.status(), /表情发送失败/);
  assert.equal(s.calls.filter(c => c.url.pathname === '/msg/send').length, 1);
});
test('switching back to numbers restores the native numeric task', async t => {
  const s = setup(t, { randomSequence: [0,.1,.2,.3,.4,.5,.6,.7,.8,.9] }); await selectEmoji(s);
  const type = s.ui.getElementById('message-type');
  type.value = 'number'; type.dispatchEvent(new s.w.Event('change'));
  s.ui.getElementById('danmaku-only').click(); await s.clock.tickAsync(22000);
  assert.deepEqual(s.fixture.messages.map(m => m.value), ['1','2','3','4','5','6','7','8','9','10']);
  assert.equal(s.calls.filter(c => c.url.pathname === '/msg/send').length, 0);
});
test('draws each numeric message independently from 1 to 10, allowing repeats', async t => {
  const s = setup(t, { randomSequence: [.999, 0, .999, .4, .4] });
  s.ui.getElementById('danmaku-only').click(); await s.clock.tickAsync(22000);
  assert.deepEqual(s.fixture.messages.map(m => m.value), ['10','1','10','5','5','10','1','10','5','5']);
});
test('random emoji mode loads automatically and samples only unlocked items on every send', async t => {
  const s = setup(t, { randomSequence: [0, .999, .999, 0, 0] });
  const type = s.ui.getElementById('message-type');
  type.value = 'emoji'; type.dispatchEvent(new s.w.Event('change'));
  s.ui.getElementById('danmaku-only').click(); await s.clock.tickAsync(22000);
  const values = s.calls.filter(c => c.url.pathname === '/msg/send').map(c => new URLSearchParams(c.init.body).get('msg'));
  assert.deepEqual(values, ['room_999_happy','up_happy','up_happy','room_999_happy','room_999_happy',
    'room_999_happy','up_happy','up_happy','room_999_happy','room_999_happy']);
  assert.equal(s.fixture.messages.length, 0);
});
test('waits for emoji HTTP acknowledgement before starting likes', async t => {
  const s = setup(t, { sendDelay: 3000 }); await selectEmoji(s);
  s.ui.getElementById('start').click(); await s.clock.tickAsync(2000);
  assert.equal(s.fixture.likes.length, 0);
  assert.equal(s.ui.getElementById('message-count').textContent, '0');
  await s.clock.tickAsync(1100);
  assert.equal(s.ui.getElementById('message-count').textContent, '1');
  assert.ok(s.fixture.likes.length > 0);
  s.ui.getElementById('stop').click(); await s.clock.tickAsync(100);
});
test('an emoji send with unknown outcome blocks a new run instead of duplicating it', async t => {
  const s = setup(t, { networkError: true }); await selectEmoji(s);
  s.ui.getElementById('start').click(); await s.clock.tickAsync(1000);
  s.ui.getElementById('start').click(); await s.clock.tickAsync(1000);
  assert.equal(s.calls.filter(c => c.url.pathname === '/msg/send').length, 1);
  assert.match(s.status(), /未确认.*刷新/);
});
