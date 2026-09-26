const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().includes('/likeReportV3')) return route.fulfill({
        contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://live.bilibili.com' },
        body: JSON.stringify({ code: 0 }),
      });
      return route.fulfill({ contentType: 'text/html', body: '<html lang="zh-CN"><meta charset="utf-8"><style>body{background:#edf0f5;font:16px system-ui}#chat-control-panel-vm{position:fixed;right:30px;bottom:30px}textarea{width:250px;height:60px}</style><h1 style="margin-left:320px">内置接口模拟测试</h1><div id="chat-control-panel-vm"><textarea placeholder="弹幕输入框"></textarea></div></html>' });
    });
    async function mount(options) {
      await page.goto('https://live.bilibili.com/123');
      await page.clock.install();
      await page.addScriptTag({ path: path.join(__dirname, 'native-fixture.cjs') });
      await page.evaluate(options => {
        localStorage.removeItem('bilistream.helper.ui.v1');
        window.fixture = window.installNativeFixture(window, options);
        let randomIndex = 0;
        Math.random = () => (randomIndex++ % 10) / 10;
      }, options);
      await page.addScriptTag({ path: path.join(__dirname, '../bilistream-intimacy.user.js') });
    }
    await mount({});
    // Exercise the whole native flow with the Page Visibility API reporting hidden.
    // This does not emulate the browser's own timer throttling or tab freezing.
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
    await page.getByRole('button', { name: '开始全部', exact: true }).click();
    await page.clock.runFor(180000);
    const state = await page.evaluate(() => {
      const ui = document.getElementById('bilistream-helper').shadowRoot;
      return { messages: fixture.messages, likes: fixture.likes, events: fixture.domEvents,
        confirmed: Number(ui.getElementById('reported-count').textContent), status: ui.getElementById('status').textContent };
    });
    assert.deepEqual(state.messages.map(m => m.value), ['1','2','3','4','5','6','7','8','9','10']);
    assert.deepEqual(state.messages.map(m => m.likesBefore), [0,30,60,90,120,150,180,210,240,270]);
    assert.equal(state.likes.length, 300);
    for (let i = 1; i < 300; i++) assert.ok(state.likes[i].at - state.likes[i - 1].at >= 375);
    assert.equal(state.confirmed, 300);
    assert.deepEqual(state.events, []);
    assert.match(state.status, /执行完毕/);
    await page.screenshot({ path: path.join(__dirname, '../docs/browser-smoke.png'), fullPage: true });
    await page.getByRole('button', { name: '折叠面板', exact: true }).click();
    const box = await page.locator('#bilistream-helper').boundingBox();
    assert.ok(box.x === 0 && box.y > 700 && box.width < 100);
    await page.getByRole('button', { name: '展开面板', exact: true }).click();
    const beforeResize = await page.locator('#bilistream-helper').boundingBox();
    const handle = await page.locator('#resize-handle').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 80, handle.y + handle.height / 2);
    await page.mouse.up();
    const afterResize = await page.locator('#bilistream-helper').boundingBox();
    assert.ok(afterResize.width > beforeResize.width + 60);
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    await page.reload();
    await page.addScriptTag({ path: path.join(__dirname, 'native-fixture.cjs') });
    await page.evaluate(() => { window.fixture = window.installNativeFixture(window, {}); });
    await page.addScriptTag({ path: path.join(__dirname, '../bilistream-intimacy.user.js') });
    assert.equal(await page.getByRole('tab', { name: '设置', exact: true }).getAttribute('aria-selected'), 'true');
    assert.ok((await page.locator('#bilistream-helper').boundingBox()).width > beforeResize.width + 60);
    await mount({ useXHR: true, reportInQuery: true });
    await page.getByRole('button', { name: '只点赞', exact: true }).click();
    await page.clock.runFor(6500);
    await page.waitForFunction(() => Number(document.getElementById('bilistream-helper').shadowRoot.getElementById('reported-count').textContent) >= 15);
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.clock.runFor(100);
    await mount({});
    await page.evaluate(() => {
      document.cookie = 'bili_jct=mock-csrf';
      Math.random = () => 0;
      const original = window.fetch;
      window.emojiSends = [];
      window.fetch = async (url, init = {}) => {
        const path = new URL(url).pathname;
        let result;
        if (path.endsWith('/GetEmoticons')) result = { code: 0, data: { data: [{ pkg_type: 2, pkg_name: '房间专属', emoticons: [
          { emoji: '[开心]', emoticon_unique: 'room_999_happy', perm: 1 },
          { emoji: '[舰长]', emoticon_unique: 'room_999_captain', perm: 0 },
        ] }, { pkg_type: 4, pkg_name: 'UP主大表情', emoticons: [{ emoji: '[UP]', emoticon_unique: 'up_happy', perm: 1 }] },
          { pkg_type: 1, pkg_name: '通用大表情', emoticons: [{ emoji: '[通用]', emoticon_unique: 'generic_emoji', perm: 1 }] }] } };
        else if (path === '/x/web-interface/nav') result = { data: { wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } } };
        else if (path === '/msg/send') { window.emojiSends.push(Object.fromEntries(new URLSearchParams(init.body))); result = { code: 0 }; }
        else return original(url, init);
        return new Response(JSON.stringify(result), { status: 200 });
      };
    });
    await page.getByRole('tab', { name: '表情', exact: true }).click();
    await page.getByRole('button', { name: '读取房间表情', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('bilistream-helper').shadowRoot.querySelector('[data-emoji="room_999_happy"]'));
    assert.equal(await page.locator('[data-emoji="room_999_captain"]').isDisabled(), true);
    assert.equal(await page.locator('[data-emoji="up_happy"]').count(), 1);
    assert.equal(await page.locator('[data-emoji="generic_emoji"]').count(), 0);
    await page.getByRole('combobox', { name: '弹幕内容', exact: true }).selectOption('emoji');
    await page.getByRole('tab', { name: '任务', exact: true }).click();
    await page.getByRole('button', { name: '开始全部', exact: true }).click();
    await page.clock.runFor(1000);
    const emojiState = await page.evaluate(() => ({ sends: window.emojiSends, likes: fixture.likes.length, messages: fixture.messages.length,
      status: document.getElementById('bilistream-helper').shadowRoot.getElementById('status').textContent }));
    assert.equal(emojiState.sends.length, 1, emojiState.status);
    assert.equal(emojiState.sends[0].msg, 'room_999_happy');
    assert.equal(emojiState.sends[0].dm_type, '1');
    assert.ok(emojiState.likes > 0);
    assert.equal(emojiState.messages, 0);
    await page.getByRole('tab', { name: '表情', exact: true }).click();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.clock.runFor(100);
    await page.screenshot({ path: path.join(__dirname, '../docs/emoji-smoke.png'), fullPage: true });
    await mount({});
    await page.evaluate(() => {
      fixture.vm.$store.getters.baseInfoUser = { uid: 888 };
      fixture.vm.$store.getters.baseInfoAnchor = { uid: 777 };
      window.fetch = async url => {
        const path = new URL(url).pathname;
        let result;
        if (path.endsWith('/fansMedal/panel')) result = { code: 0, data: { total_number: 2, list: [
          { medal: { target_id: 777 }, room_info: { room_id: 999, living_status: 1 }, anchor_info: { nick_name: '当前主播' } },
          { medal: { target_id: 778 }, room_info: { room_id: 2003, living_status: 1 }, anchor_info: { nick_name: '粉丝牌主播' } },
        ] } };
        else if (path === '/x/web-interface/nav') result = { data: { wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } } };
        else if (path.endsWith('/GetActivatedMedalInfo')) result = { code: 0, data: { is_lighted: true, task_info: [
          { title: '发弹幕', sub_title: '每日上限 10/10' }, { title: '点赞30次', sub_title: '每日上限 10/10' },
        ] } };
        else throw new Error('Unexpected test request');
        return new Response(JSON.stringify(result), { status: 200 });
      };
    });
    await page.getByRole('button', { name: '读取粉丝牌', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('bilistream-helper').shadowRoot.getElementById('medal-rooms').open);
    assert.equal(await page.locator('#medal-list').isVisible(), true);
    await page.locator('#medal-summary').click();
    assert.equal(await page.locator('#medal-list').isVisible(), false);
    await page.getByRole('button', { name: '开始粉丝牌任务', exact: true }).click();
    await page.clock.runFor(1000);
    await page.waitForFunction(() => document.getElementById('bilistream-helper').shadowRoot.getElementById('status').textContent.includes('任务已完成'));
    assert.equal(await page.locator('#medal-list').isVisible(), false);
    await page.locator('#medal-summary').click();
    assert.equal(await page.locator('#medal-list').isVisible(), true);
    await page.screenshot({ path: path.join(__dirname, '../docs/medal-smoke.png'), fullPage: true });
    await page.locator('#bilistream-helper').screenshot({ path: path.join(__dirname, '../docs/chatterbox-preview.png') });
    await page.setViewportSize({ width: 375, height: 667 });
    assert.ok((await page.locator('#bilistream-helper').boundingBox()).width <= 351);
    assert.equal(await page.getByRole('button', { name: '开始全部', exact: true }).isVisible(), true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      const style = document.documentElement.style;
      for (const [key, value] of Object.entries({ '--bg1': '#202127', '--bg2': '#292b32', '--text1': '#f1f2f3', '--Ga2': '#393c44', '--Ga6': '#a0a7b4' })) style.setProperty(key, value);
    });
    assert.equal(await page.locator('#bilistream-helper section').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 33, 39)');
    await page.locator('#bilistream-helper').screenshot({ path: path.join(__dirname, '../docs/chatterbox-dark-preview.png') });
    assert.deepEqual(errors, []);
    console.log('Edge passed: native 10 x 30 tasks, emoji tab sending, cross-tab stopping, medal folding, pointer resize, persisted tab/width, mobile layout and host dark theme.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
