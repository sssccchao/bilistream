const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const { installNativeFixture } = require('./native-fixture.cjs');

const source = fs.readFileSync(require('node:path').join(__dirname, '../bilistream-intimacy.user.js'), 'utf8');
const imgKey = '7cd084941338484aae1ad9425b84077c';
const subKey = '4932caff0ff746eab6f01bf08b70ac45';
const tab = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const mixin = tab.map(i => (imgKey + subKey)[i]).join('').slice(0, 32);
function signedCorrectly(url) {
  const params = new URL(url).searchParams;
  const pairs = [...params].filter(([key]) => key !== 'w_rid')
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value.replace(/[!'()*]/g, ''))}`);
  return params.get('w_rid') === crypto.createHash('md5').update(pairs.join('&') + mixin).digest('hex');
}
function setup(t, options = {}) {
  const dom = new JSDOM('<div id="chat-control-panel-vm"><textarea></textarea></div>', {
    url: 'https://live.bilibili.com/123', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.Response = Response; w.Request = Request;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fixture = installNativeFixture(w);
  let randomIndex = 0;
  w.Math.random = () => (randomIndex++ % 10) / 10;
  fixture.vm.$store.getters.baseInfoUser = { uid: 888 };
  fixture.vm.$store.getters.baseInfoAnchor = { uid: 777 };
  const calls = [];
  const states = {
    '2001': { live: true, lit: true, messages: 10, likes: 10, clicks: 0 },
    '2002': { live: false, lit: true, messages: 1, likes: 0, clicks: 0 },
    '2003': { live: true, lit: false, messages: 0, likes: 0, clicks: 0 },
  };
  for (const [roomId, override] of Object.entries(options.roomStates || {})) Object.assign(states[roomId], override);
  w.document.cookie = 'bili_jct=csrf-token';
  w.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ url: String(url), init, at: w.Date.now() });
    let result;
    if (parsed.pathname === '/x/web-interface/nav') {
      result = { code: -101, data: { wbi_img: { img_url: `https://i0.hdslb.com/bfs/wbi/${imgKey}.png`, sub_url: `https://i0.hdslb.com/bfs/wbi/${subKey}.png` } } };
    } else if (parsed.pathname.endsWith('/fansMedal/panel')) {
      const page = Number(parsed.searchParams.get('page'));
      const room = (roomId, uid, name, living = 1) => ({ medal: { target_id: uid, medal_id: uid + 100 }, room_info: { room_id: roomId, living_status: living }, anchor_info: { nick_name: name } });
      result = { code: 0, data: page === 1 ? { total_number: 12,
        special_list: [room(2001, 3001, '一号')], list: [room(2002, 3002, '二号', 0), room(2001, 3001, '一号')] }
        : { total_number: 12, special_list: [room(2001, 3001, '一号')], list: [room(2003, 3003, '三号')] } };
    } else if (parsed.pathname.endsWith('/fansMedal/GetActivatedMedalInfo')) {
      assert.equal(parsed.searchParams.get('csrf'), 'csrf-token');
      const state = states[parsed.searchParams.get('room_id')];
      if (!state) throw new Error('unknown medal room');
      result = { code: 0, data: { is_lighted: state.lit, task_info: state.lit ? [
        { title: '发弹幕', sub_title: `每日上限 ${state.messages}/10`, is_done: state.messages === 10 },
        { title: '点赞30次', sub_title: `每日上限 ${state.likes}/10`, is_done: state.likes === 10 },
      ] : [
        { title: '发弹幕10次', sub_title: '仅点亮', is_done: false },
        { title: '点赞30次', sub_title: '仅点亮', is_done: false },
      ] } };
    } else if (parsed.pathname.endsWith('/GetEmoticons')) {
      const roomId = parsed.searchParams.get('room_id');
      result = { code: 0, data: { data: [{ pkg_type: 2, pkg_name: '房间专属', emoticons: [
        { emoji: '[开心]', emoticon_unique: `room_${roomId}_happy`, perm: 1 },
        { emoji: '[挥手]', emoticon_unique: `room_${roomId}_wave`, perm: 1 },
      ] }] } };
    } else if (parsed.pathname === '/msg/send') {
      const roomId = new URLSearchParams(init.body).get('roomid');
      if (!options.sendCode && states[roomId].lit) states[roomId].messages = Math.min(10, states[roomId].messages + 1);
      result = { code: options.sendCode || 0, message: options.sendCode ? '发送失败' : '' };
    } else if (parsed.pathname.endsWith('/likeReportV3')) {
      const state = states[parsed.searchParams.get('room_id')];
      const code = parsed.searchParams.get('csrf') !== 'csrf-token' ? -111 : options.likeCode || 0;
      if (code === 0) {
        state.clicks += Number(parsed.searchParams.get('click_time'));
        if (!state.lit && state.clicks >= 30) {
          state.clicks = 0;
          if (options.lightDelay) w.setTimeout(() => { state.lit = true; }, options.lightDelay);
          else state.lit = true;
        }
        else if (state.lit && state.live && !options.noLikeProgress) {
          while (state.clicks >= 30) { state.likes = Math.min(10, state.likes + 1); state.clicks -= 30; }
        }
      }
      result = { code, message: code ? code === -111 ? 'CSRF 校验失败' : '点赞失败' : '' };
    } else throw new Error(`unexpected request ${url}`);
    return new w.Response(JSON.stringify(result), { status: 200 });
  };
  w.eval(source);
  const ui = w.document.getElementById('bilistream-helper').shadowRoot;
  t.after(() => { clock.uninstall(); w.close(); });
  return { w, clock, ui, calls, states, fixture, click: id => ui.getElementById(id).click(),
    status: () => ui.getElementById('status').textContent };
}

test('scans every medal page, deduplicates rooms and keeps offline rooms in the queue', async t => {
  const s = setup(t);
  s.click('scan-medals'); await s.clock.tickAsync(100);
  const panels = s.calls.filter(c => c.url.includes('/fansMedal/panel'));
  assert.deepEqual(panels.map(c => new URL(c.url).searchParams.get('page')), ['1', '2']);
  assert.match(s.ui.getElementById('medal-summary').textContent, /3.*2.*1/);
  assert.match(s.ui.getElementById('medal-list').textContent, /一号/);
  assert.match(s.ui.getElementById('medal-list').textContent, /二号/);
  assert.equal(s.ui.getElementById('start-medals').disabled, false);
});
test('medal room list can stay folded while task progress updates', async t => {
  const s = setup(t, { roomStates: { '2003': { lit: true, messages: 10, likes: 10 }, '2002': { messages: 10 } } });
  s.click('scan-medals'); await s.clock.tickAsync(100);
  const details = s.ui.getElementById('medal-rooms');
  assert.ok(details, '房间列表应支持折叠');
  assert.equal(details.hidden, false);
  assert.equal(details.open, true);
  details.open = false;
  s.click('start-medals'); await s.clock.tickAsync(1000);
  assert.equal(details.open, false);
  assert.match(details.textContent, /任务已完成/);
});

test('keeps selected exclusive emoji within its configured room and leaves other rooms numeric', async t => {
  const s = setup(t, { roomStates: { '2003': { lit: true, messages: 9, likes: 9 }, '2002': { messages: 9 } } });
  s.w.Math.random = () => .999;
  s.click('scan-medals'); await s.clock.tickAsync(100);
  const room = s.ui.getElementById('emoji-room');
  room.value = '2003'; room.dispatchEvent(new s.w.Event('change'));
  s.click('load-emojis'); await s.clock.tickAsync(100);
  s.ui.querySelector('[data-emoji="room_2003_happy"]').click();
  room.value = ''; room.dispatchEvent(new s.w.Event('change'));
  assert.equal(s.ui.getElementById('message-type').value, 'number');
  s.click('start-medals'); await s.clock.tickAsync(30000);
  const sends = s.calls.filter(c => new URL(c.url).pathname === '/msg/send').map(c => new URLSearchParams(c.init.body));
  assert.equal(sends.length, 2);
  assert.equal(sends[0].get('roomid'), '2003');
  assert.equal(sends[0].get('msg'), 'room_2003_wave');
  assert.equal(sends[0].get('dm_type'), '1');
  assert.equal(sends[1].get('roomid'), '2002');
  assert.equal(sends[1].get('msg'), '10');
  assert.equal(sends[1].get('dm_type'), null);
  assert.deepEqual([s.states['2003'].messages, s.states['2003'].likes], [10,10]);
});
test('cross-room emoji tasks draw a new item per message from the target room pool', async t => {
  const s = setup(t, { roomStates: { '2003': { lit: true, messages: 8, likes: 10 }, '2002': { messages: 10 } } });
  let index = 0;
  s.w.Math.random = () => [.999, 0][index++ % 2];
  s.click('scan-medals'); await s.clock.tickAsync(100);
  const room = s.ui.getElementById('emoji-room');
  room.value = '2003'; room.dispatchEvent(new s.w.Event('change'));
  const type = s.ui.getElementById('message-type');
  type.value = 'emoji'; type.dispatchEvent(new s.w.Event('change'));
  s.click('start-medals'); await s.clock.tickAsync(5000);
  const sends = s.calls.filter(c => new URL(c.url).pathname === '/msg/send').map(c => new URLSearchParams(c.init.body));
  assert.deepEqual(sends.map(body => body.get('msg')), ['room_2003_wave', 'room_2003_happy']);
  assert.ok(sends.every(body => body.get('roomid') === '2003' && body.get('dm_type') === '1'));
  assert.equal(s.states['2003'].messages, 10);
});

test('skips completed tasks, lights an unlit live badge, finishes remaining tasks and defers offline likes', async t => {
  const s = setup(t);
  s.click('scan-medals'); await s.clock.tickAsync(100);
  s.click('start-medals'); await s.clock.tickAsync(240000);
  const messages = s.calls.filter(c => new URL(c.url).pathname === '/msg/send');
  const likes = s.calls.filter(c => new URL(c.url).pathname.endsWith('/likeReportV3'));
  assert.equal(messages.length, 19);
  assert.equal(likes.length, 22);
  assert.deepEqual([...new Set(messages.map(c => new URLSearchParams(c.init.body).get('roomid')))], ['2003', '2002']);
  assert.deepEqual(messages.filter(c => new URLSearchParams(c.init.body).get('roomid') === '2003')
    .map(c => new URLSearchParams(c.init.body).get('msg')), ['1','2','3','4','5','6','7','8','9','10']);
  assert.equal(likes.every(c => new URL(c.url).searchParams.get('room_id') === '2003'), true);
  assert.ok(likes.every(c => new URL(c.url).searchParams.get('click_time') === '15'));
  assert.ok(likes.every(c => new URL(c.url).searchParams.get('csrf') === 'csrf-token'));
  assert.ok(likes.every(c => signedCorrectly(c.url)));
  assert.ok(messages.every(c => signedCorrectly(c.url)));
  for (let i = 1; i < likes.length; i++) assert.ok(likes[i].at - likes[i - 1].at >= 15 * 334);
  assert.deepEqual([s.states['2001'].messages,s.states['2001'].likes], [10,10]);
  assert.deepEqual([s.states['2003'].messages,s.states['2003'].likes], [10,10]);
  assert.deepEqual([s.states['2002'].messages,s.states['2002'].likes], [10,0]);
  assert.equal(s.fixture.messages.length + s.fixture.likes.length, 0);
  assert.match(s.ui.getElementById('medal-list').textContent, /点赞待开播/);
  assert.match(s.status(), /待开播/);
});

test('stops the cross-room queue on a rejected send without trying another room', async t => {
  const s = setup(t, { sendCode: 10030, roomStates: { '2003': { lit: true } } });
  s.click('scan-medals'); await s.clock.tickAsync(100);
  s.click('start-medals'); await s.clock.tickAsync(10000);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname === '/msg/send').length, 1);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname.endsWith('/likeReportV3')).length, 0);
  assert.match(s.status(), /发送失败/);
});

test('restart reads task progress and resumes the missing likes without another message', async t => {
  const s = setup(t, { likeCode: 10030, roomStates: { '2003': { lit: true } } });
  s.click('scan-medals'); await s.clock.tickAsync(100);
  s.click('start-medals'); await s.clock.tickAsync(15000);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname === '/msg/send').length, 1);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname.endsWith('/likeReportV3')).length, 1);
  s.click('start-medals'); await s.clock.tickAsync(15000);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname === '/msg/send').length, 1);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname.endsWith('/likeReportV3')).length, 2);
  assert.equal(s.states['2003'].messages, 1);
});

test('does not count accepted like reports as completed tasks when the server leaves progress unchanged', async t => {
  const s = setup(t, { noLikeProgress: true, roomStates: { '2003': { lit: true } } });
  s.click('scan-medals'); await s.clock.tickAsync(100);
  s.click('start-medals'); await s.clock.tickAsync(20000);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname === '/msg/send').length, 1);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname.endsWith('/likeReportV3')).length, 2);
  assert.equal(s.states['2003'].likes, 0);
  assert.match(s.status(), /未计入/);
});

test('waits for delayed medal lighting before sending task messages', async t => {
  const s = setup(t, { lightDelay: 1200, sendCode: 10030 });
  s.click('scan-medals'); await s.clock.tickAsync(100);
  s.click('start-medals'); await s.clock.tickAsync(15000);
  assert.equal(s.states['2003'].lit, true);
  assert.equal(s.calls.filter(c => new URL(c.url).pathname === '/msg/send').length, 1);
  assert.match(s.status(), /发送失败/);
});
