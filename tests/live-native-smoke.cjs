// Optional online compatibility probe. No real messages or likes leave the browser:
// ALL non-read requests are fulfilled locally or blocked before network dispatch.
const { chromium } = require('playwright-core');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const reports = [];
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === 'api.live.bilibili.com' && url.pathname.endsWith('/likeReportV3')) {
        // Capture field names only, never cookies or field values.
        reports.push({ method: request.method(), contentType: request.headers()['content-type'] || '',
          fieldNames: [...new URLSearchParams(request.postData() || '').keys()], queryFieldNames: [...url.searchParams.keys()] });
        return route.fulfill({ contentType: 'application/json',
          headers: { 'access-control-allow-origin': 'https://live.bilibili.com', 'access-control-allow-credentials': 'true' },
          body: JSON.stringify({ code: 0, data: {}, message: 'local fixture' }) });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || ['media', 'image', 'font'].includes(request.resourceType())) return route.abort();
      return route.continue();
    });
    await page.goto('https://live.bilibili.com/6', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('chat-control-panel-vm')?.__vue__, {}, { timeout: 20000 });
    await page.evaluate(() => {
      const vm = document.getElementById('chat-control-panel-vm').__vue__;
      // Only the fresh test page is altered. No browser profile or credentials used.
      Object.defineProperty(vm, 'isLogin', { configurable: true, value: true });
      vm.checkIsLogin = async () => true;
    });
    await page.addScriptTag({ path: path.join(__dirname, '../bilistream-intimacy.user.js') });
    await page.getByRole('button', { name: '只点赞', exact: true }).click();
    await page.waitForFunction(() => {
      const ui = document.getElementById('bilistream-helper').shadowRoot;
      return Number(ui.getElementById('reported-count').textContent) > 0 || ui.getElementById('stop').disabled;
    }, {}, { timeout: 30000 }).catch(() => {});
    const result = await page.evaluate(() => {
      const ui = document.getElementById('bilistream-helper').shadowRoot;
      return { status: ui.getElementById('status').textContent,
        received: Number(ui.getElementById('like-count').textContent), confirmed: Number(ui.getElementById('reported-count').textContent),
        hidden: document.hidden,
        nativePending: document.getElementById('chat-control-panel-vm').__vue__.localSingleReportIntervalLikeNum };
    });
    await page.getByRole('button', { name: '停止', exact: true }).click({ timeout: 2000 }).catch(() => {});
    console.log(JSON.stringify({ result, reports }));
    assert.ok(result.confirmed > 0, 'Actual page report must be recognized against a mocked response');
    console.log('Live page native compatibility passed; server responses mocked, no real likes sent.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
