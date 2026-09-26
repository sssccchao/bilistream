// ==UserScript==
// @name         哔哩哔哩直播亲密度助手
// @namespace    bilistream.intimacy-helper
// @version      1.6.0
// @description  支持房间专属表情替代数字弹幕；按粉丝牌任务进度完成弹幕与点赞。
// @match        https://live.bilibili.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self || !/^\/\d+\/?$/.test(location.pathname)) return;
  if (document.getElementById('bilistream-helper')) return;

  const MESSAGE_INTERVAL = 2000;
  const LIKE_INTERVAL = Math.ceil(1000 / 3);
  const BACKGROUND_WAIT = 180000;
  const REPORT_PATH = '/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3';
  const API = 'https://api.live.bilibili.com';
  const WBI_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
  let job = null;
  let needsReload = false;
  let medals = [];
  const emojiRooms = new Set();
  let displayedEmojis = [];
  const UI_PREFS_KEY = 'bilistream.helper.ui.v1';
  const tabs = ['tasks', 'emojis', 'settings'];
  const panelPrefs = { tab: 'tasks', width: 320, collapsed: false };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_PREFS_KEY));
    if (tabs.includes(saved?.tab)) panelPrefs.tab = saved.tab;
    if (Number.isFinite(saved?.width)) panelPrefs.width = saved.width;
    if (typeof saved?.collapsed === 'boolean') panelPrefs.collapsed = saved.collapsed;
  } catch { /* Storage may be unavailable or from an interrupted update. */ }

  const host = document.createElement('div');
  host.id = 'bilistream-helper';
  host.tabIndex = -1;
  host.style.cssText = 'position:fixed;z-index:2147483647;outline:none;';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
      :host { left:12px; bottom:44px; --panel-width:320px;
        --surface:var(--bg1, #fff); --surface-soft:var(--bg2, #f5f5f5);
        --line:var(--Ga2, #eee); --text:var(--text1, #18191c); --muted:var(--Ga6, #797f87);
        --accent:#36a185; --danger:#d44; color:var(--text); }
      :host([data-collapsed]) { left:0; top:auto; bottom:12px; }
      * { box-sizing:border-box; }
      section { position:relative; width:var(--panel-width); max-width:calc(100vw - 24px); max-height:calc(100vh - 68px);
        display:flex; flex-direction:column; border:1px solid var(--line); border-radius:5px;
        box-shadow:0 3px 16px #0002; background:var(--surface); color:var(--text);
        font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif; overflow:hidden; }
      header { display:flex; align-items:center; gap:7px; padding:9px 10px 5px; }
      strong { font-size:13px; font-weight:600; flex:1; }
      .state-dot { width:6px; height:6px; border-radius:50%; background:var(--muted); }
      :host([data-busy]) .state-dot { background:var(--accent); }
      main { padding:8px 10px 10px; overflow:auto; min-height:0; }
      p { margin:5px 0; } .muted { color:var(--muted); font-size:12px; }
      .counts { display:flex; gap:14px; margin:0 0 10px; font-variant-numeric:tabular-nums; }
      .counts > div { flex:1; } .counts b { font-weight:600; }
      progress { display:block; width:100%; height:4px; margin-top:6px; border:0; border-radius:2px; overflow:hidden;
        appearance:none; background:var(--surface-soft); accent-color:var(--accent); }
      progress::-webkit-progress-bar { background:var(--surface-soft); }
      progress::-webkit-progress-value { background:var(--accent); }
      .row { display:flex; gap:5px; margin:7px 0; }
      button { border:1px solid var(--line); border-radius:4px; padding:4px 7px; min-height:28px;
        background:var(--surface); color:inherit; cursor:pointer;
        font:inherit; flex:1; }
      button:not(:disabled):hover { background:var(--surface-soft); }
      button:focus-visible, summary:focus-visible, select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      button:disabled { opacity:.45; cursor:default; }
      #start, #start-medals:not(:disabled) { background:var(--accent); color:white; border-color:var(--accent); }
      #start:not(:disabled):hover, #start-medals:not(:disabled):hover { filter:brightness(.95); }
      #stop { flex:0 0 auto; color:var(--danger); border-color:transparent; min-width:42px; }
      #collapse { flex:0 0 auto; min-height:22px; padding:0 5px; border:0; color:var(--muted); }
      .tabs { display:flex; gap:3px; padding:0 6px; border-bottom:1px solid var(--line); }
      .tabs button { flex:0 0 auto; border:0; border-bottom:2px solid transparent; border-radius:0;
        background:transparent; padding:6px 10px; margin-bottom:-1px; }
      .tabs [aria-selected="true"] { border-bottom-color:var(--accent); color:var(--accent); font-weight:600; }
      footer { display:flex; align-items:center; gap:8px; padding:5px 8px 5px 10px;
        border-top:1px solid var(--line); background:var(--surface-soft); }
      #status { flex:1; overflow-wrap:anywhere; margin:0; font-size:12px; max-height:72px; overflow:auto; }
      .settings .row { align-items:center; }
      .settings .row select { flex:1; width:0; margin:0; }
      label { display:block; margin:5px 0 3px; color:var(--muted); font-size:12px; }
      #load-emojis { flex:0 0 auto; white-space:nowrap; }
      details { margin-top:8px; font-size:12px; }
      .group { border-bottom:1px solid var(--line); padding-bottom:7px; }
      .group:last-child { border-bottom:0; padding-bottom:0; }
      summary { cursor:pointer; padding:3px 0; color:var(--muted); }
      .group > summary { color:var(--text); font-size:13px; }
      details p { margin:5px 0; }
      #emoji-summary:empty, #emoji-list:empty, #medal-summary:empty, #medal-list:empty { display:none; }
      #medal-list { max-height:130px; overflow:auto; padding:0 0 0 19px; margin:5px 0 10px; font-size:12px; }
      select { width:100%; padding:5px 6px; margin:3px 0; border:1px solid var(--line); border-radius:4px;
        background:var(--surface); color:inherit; font:inherit; }
      #emoji-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(58px,1fr)); gap:4px;
        max-height:260px; overflow:auto; margin:8px 0; }
      #emoji-list button { padding:4px; min-width:0; font-size:11px; overflow-wrap:anywhere; border-color:transparent; }
      #emoji-list img { display:block; width:42px; height:42px; object-fit:contain; margin:auto; }
      #emoji-list [aria-pressed="true"] { border-color:var(--accent); background:var(--surface-soft); }
      .info-row { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--line); }
      #resize-handle { position:absolute; top:30px; right:0; bottom:38px; width:6px; cursor:ew-resize;
        touch-action:none; z-index:2; }
      #resize-handle:hover { background:var(--line); }
      :host([data-collapsed]) section { width:auto; border-radius:0 4px 4px 0; box-shadow:0 2px 6px #0002; }
      :host([data-collapsed]) header { padding:0; }
      :host([data-collapsed]) strong, :host([data-collapsed]) .state-dot, :host([data-collapsed]) .tabs,
      :host([data-collapsed]) footer, :host([data-collapsed]) #resize-handle { display:none; }
      :host([data-collapsed]) #collapse { padding:6px 10px; border:0; border-radius:0; background:var(--muted);
        color:white; font-size:12px; white-space:nowrap; }
      :host([data-collapsed][data-busy]) #collapse { background:var(--accent); }
      [hidden] { display:none !important; }
    </style>
    <section aria-label="直播亲密度助手">
      <header><span class="state-dot" aria-hidden="true"></span><strong>亲密度助手</strong><button id="collapse" aria-label="折叠面板" aria-expanded="true" title="折叠">−</button></header>
      <nav class="tabs" role="tablist" aria-label="助手功能">
        <button id="tab-tasks" role="tab" aria-controls="panel-tasks">任务</button>
        <button id="tab-emojis" role="tab" aria-controls="panel-emojis">表情</button>
        <button id="tab-settings" role="tab" aria-controls="panel-settings">设置</button>
      </nav>
      <main>
        <div id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
          <div class="counts">
            <div>弹幕 <b id="message-count">0</b>/10<progress id="message-progress" max="10" value="0" aria-label="弹幕进度"></progress></div>
            <div>点赞 <b id="like-count">0</b>/300<progress id="like-progress" max="300" value="0" aria-label="点赞进度"></progress></div>
          </div>
          <details class="group" open><summary>当前房间</summary>
            <div class="row"><button id="start">开始全部</button></div>
            <div class="row"><button id="danmaku-only">只发弹幕</button><button id="likes-only">只点赞</button></div>
          </details>
          <details class="group" open><summary>粉丝牌任务</summary>
            <div class="row"><button id="scan-medals">读取粉丝牌</button><button id="start-medals" disabled>开始粉丝牌任务</button></div>
            <details id="medal-rooms" hidden><summary id="medal-summary"></summary>
              <ol id="medal-list" aria-label="粉丝牌房间"></ol>
            </details>
          </details>
        </div>
        <div id="panel-emojis" class="settings" role="tabpanel" aria-labelledby="tab-emojis" hidden>
          <label for="emoji-room">房间</label><select id="emoji-room" aria-label="设置弹幕的房间"><option value="">当前房间</option></select>
          <label for="message-type">内容</label>
          <div class="row"><select id="message-type" aria-label="弹幕内容"><option value="number">随机数字</option><option value="emoji">随机表情</option></select><button id="load-emojis">读取房间表情</button></div>
          <div id="emoji-list" aria-label="房间表情"></div>
          <p id="emoji-summary" class="muted"></p>
        </div>
        <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden>
          <div class="info-row"><span>上报确认</span><span><b id="reported-count">0</b>/<span id="reported-target">300</span></span></div>
          <p id="rate" class="muted">每秒最多 3 赞</p>
          <div class="row"><button id="check-native">检测内置接口</button></div>
        </div>
      </main>
      <footer><p id="status" role="status" aria-live="polite">就绪</p><button id="stop" disabled>停止</button></footer>
      <div id="resize-handle" title="拖动调整宽度" aria-hidden="true"></div>
    </section>`;
  document.body.appendChild(host);
  const el = id => ui.getElementById(id);
  const status = message => { el('status').textContent = message; };
  const updateCounts = task => {
    el('message-count').textContent = task.messages;
    el('like-count').textContent = task.likes;
    el('reported-count').textContent = task.reported;
    el('message-progress').value = task.messages;
    el('like-progress').value = task.likes;
  };
  function savePanelPrefs() {
    try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(panelPrefs)); } catch { /* Optional UI preferences only. */ }
  }
  function setPanelTab(tab, remember = true) {
    if (!tabs.includes(tab)) return;
    panelPrefs.tab = tab;
    for (const id of tabs) {
      const active = id === tab;
      el(`panel-${id}`).hidden = !active;
      el(`tab-${id}`).setAttribute('aria-selected', String(active));
      el(`tab-${id}`).tabIndex = active ? 0 : -1;
    }
    if (remember) savePanelPrefs();
  }
  function setCollapsed(collapsed, remember = true) {
    panelPrefs.collapsed = collapsed;
    ui.querySelector('main').hidden = collapsed;
    host.toggleAttribute('data-collapsed', collapsed);
    el('collapse').textContent = collapsed ? '亲密度 +' : '−';
    el('collapse').setAttribute('aria-expanded', String(!collapsed));
    el('collapse').setAttribute('aria-label', collapsed ? '展开面板' : '折叠面板');
    el('collapse').title = collapsed ? '展开' : '折叠';
    if (remember) savePanelPrefs();
  }
  function setPanelWidth(raw) {
    const max = Math.min(560, Math.max(1, window.innerWidth - 24));
    panelPrefs.width = Math.round(Math.max(Math.min(260, max), Math.min(raw, max)));
    host.style.setProperty('--panel-width', `${panelPrefs.width}px`);
  }
  for (const tab of tabs) {
    el(`tab-${tab}`).addEventListener('click', () => setPanelTab(tab));
    el(`tab-${tab}`).addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setPanelTab(tabs[index]);
      el(`tab-${tabs[index]}`).focus();
    });
  }
  let finishResize = null;
  el('resize-handle').addEventListener('pointerdown', event => {
    if (event.button !== 0 || panelPrefs.collapsed) return;
    event.preventDefault(); event.stopPropagation();
    finishResize?.();
    const handle = el('resize-handle'), pointerId = event.pointerId;
    const startX = event.clientX, startWidth = panelPrefs.width;
    const cursor = document.body.style.cursor, userSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
    handle.setPointerCapture?.(pointerId);
    const move = next => { if (next.pointerId === pointerId) setPanelWidth(startWidth + next.clientX - startX); };
    const end = next => {
      if (next && next.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      handle.removeEventListener('lostpointercapture', end);
      finishResize = null;
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      document.body.style.cursor = cursor; document.body.style.userSelect = userSelect;
      savePanelPrefs();
    };
    finishResize = end;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
  });
  window.addEventListener('resize', () => { setPanelWidth(panelPrefs.width); savePanelPrefs(); });
  setPanelWidth(panelPrefs.width);
  setPanelTab(panelPrefs.tab, false);
  setCollapsed(panelPrefs.collapsed, false);
  function setBusy(busy) {
    host.toggleAttribute('data-busy', busy);
    for (const id of ['start', 'danmaku-only', 'likes-only', 'check-native', 'scan-medals', 'load-emojis', 'emoji-room', 'message-type']) el(id).disabled = busy;
    for (const button of el('emoji-list').querySelectorAll('button')) button.disabled = busy || button.dataset.permitted !== 'true';
    el('start-medals').disabled = busy || medals.length === 0;
    el('stop').disabled = !busy;
  }
  function findNative() {
    const root = document.getElementById('chat-control-panel-vm');
    const queue = root?.__vue__ ? [root.__vue__] : [];
    const seen = new Set();
    while (queue.length) {
      const vm = queue.shift();
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      if (typeof vm.sendDanmaku === 'function' && typeof vm.handleLikeBtnClick === 'function') return { root, vm };
      queue.push(...(vm.$children || []));
    }
    throw new Error('未找到支持的直播页内置接口，请等待页面加载或刷新。');
  }
  function emojiRoomId() {
    const id = el('emoji-room').value || String(findNative().vm.$store?.getters?.baseInfoRoom?.roomID || '');
    if (!/^\d+$/.test(id)) throw new Error('无法识别表情房间号，请刷新。');
    return id;
  }
  function renderEmojiRooms() {
    const select = el('emoji-room');
    const previous = select.value;
    select.replaceChildren(new Option('当前房间', ''));
    const current = String(findNative().vm.$store?.getters?.baseInfoRoom?.roomID || '');
    for (const medal of medals) if (medal.roomId !== current) select.add(new Option(`${medal.name} · ${medal.roomId}`, medal.roomId));
    select.value = [...select.options].some(option => option.value === previous) ? previous : '';
  }
  async function readEmojis(roomId, task) {
    const url = new URL('/xlive/web-ucenter/v2/emoticon/GetEmoticons', API);
    url.search = new URLSearchParams({ platform: 'pc', room_id: roomId });
    const data = await requestJson(url, { method: 'GET', cache: 'no-store' }, task);
    if (!Array.isArray(data?.data)) throw new Error('房间表情列表格式发生变化。');
    const found = new Map();
    for (const pack of data.data) {
      // Names identify the requested categories; pkg_type alone also includes other packages.
      const packageName = String(pack.pkg_name || '').replace(/\s+/g, '');
      if (Number(pack.pkg_type) === 3 || !/^(?:UP主大表情|房间专属(?:表情)?)$/i.test(packageName)) continue;
      for (const emoji of pack.emoticons || []) {
        if (typeof emoji.emoticon_unique !== 'string' || !emoji.emoticon_unique) continue;
        if (!found.has(emoji.emoticon_unique)) found.set(emoji.emoticon_unique, { ...emoji, packageName: String(pack.pkg_name || '表情') });
      }
    }
    return [...found.values()];
  }
  function renderEmojis() {
    const roomId = emojiRoomId();
    const randomEmoji = emojiRooms.has(roomId);
    el('message-type').value = randomEmoji ? 'emoji' : 'number';
    el('emoji-summary').textContent = randomEmoji && displayedEmojis.length ? `随机池可用 ${displayedEmojis.filter(emoji => emoji.perm === 1).length} 个` : '';
    el('emoji-list').replaceChildren();
    for (const emoji of displayedEmojis) {
      const button = document.createElement('button');
      button.dataset.emoji = emoji.emoticon_unique;
      button.dataset.permitted = String(emoji.perm === 1);
      button.disabled = emoji.perm !== 1 || !!job;
      button.setAttribute('aria-pressed', String(randomEmoji && emoji.perm === 1));
      button.title = `${emoji.packageName} · ${emoji.emoji || emoji.descript || '表情'}${emoji.perm === 1 ? '' : ` · ${emoji.unlock_show_text || '未解锁'}`}`;
      try {
        const url = new URL(emoji.url, location.href);
        if (['http:', 'https:'].includes(url.protocol) && /(^|\.)hdslb\.com$/i.test(url.hostname)) {
          url.protocol = 'https:';
          const img = document.createElement('img'); img.src = url.href; img.alt = ''; img.loading = 'lazy';
          button.appendChild(img);
        }
      } catch { /* A missing preview must not prevent selecting an otherwise valid emoji. */ }
      button.appendChild(document.createTextNode(`${emoji.emoji || emoji.descript || '表情'}${emoji.perm === 1 ? '' : ' 🔒'}`));
      button.addEventListener('click', () => {
        if (job || emoji.perm !== 1) return;
        emojiRooms.add(roomId);
        renderEmojis();
      });
      el('emoji-list').appendChild(button);
    }
  }
  async function loadEmojis() {
    if (job) return;
    const task = { controller: new AbortController(), path: location.pathname, failure: null, pendingRequest: false };
    job = task; setBusy(true); displayedEmojis = []; el('emoji-list').replaceChildren();
    try {
      if (!findNative().vm.isLogin) throw new Error('请先登录直播间。');
      displayedEmojis = await readEmojis(emojiRoomId(), task);
      renderEmojis();
      status(displayedEmojis.length ? `表情 ${displayedEmojis.length} 个，可用 ${displayedEmojis.filter(emoji => emoji.perm === 1).length} 个` : '暂无 UP 主大表情或房间专属表情');
    } catch (error) { status(error.message || '读取表情失败。'); }
    finally { job = null; setBusy(false); }
  }
  async function resolveEmojis(roomId, rooms, task) {
    if (!rooms.has(roomId)) return [];
    const list = (await readEmojis(roomId, task)).filter(emoji => emoji.perm === 1);
    if (!list.length) throw new Error(`房间 ${roomId} 没有可用表情，请切换随机数字。`);
    return list;
  }
  function randomMessage(emojis = []) {
    const index = Math.floor(Math.random() * (emojis.length || 10));
    return emojis.length ? { emoji: emojis[index], number: null } : { emoji: null, number: index + 1 };
  }
  function likeInterval(vm) {
    const cooldown = Number(vm.likeBtnClickFrequencyLimit);
    if (!Number.isFinite(cooldown) || cooldown <= 0) throw new Error('无法读取房间点赞冷却，已停止。');
    return Math.max(LIKE_INTERVAL, Math.ceil(cooldown * 1000) + 25);
  }
  function checkNative(task) {
    if (!task.root.isConnected || task.vm._isDestroyed || findNative().vm !== task.vm) throw new Error('直播页内置组件已变化，请刷新后重试。');
    if (!task.vm.isLogin) throw new Error('请先登录直播间，再开始执行。');
  }
  // Observe the page's own reporting; never issue or retry a report ourselves.
  function observeReports(task) {
    const originalFetch = window.fetch;
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open, originalSend = proto.send;
    const requests = new WeakMap();
    let active = true;
    const relevant = (url, method) => {
      try {
        const parsed = new URL(url, location.href);
        return method.toUpperCase() === 'POST' && parsed.hostname === 'api.live.bilibili.com' && parsed.pathname === REPORT_PATH;
      } catch { return false; }
    };
    function ticket(url, body) {
      task.inflight++;
      let count = 0, ignored = false, finished = false;
      const ready = Promise.resolve(body).then(value => {
        if (!active) return;
        // Current native POSTs use URL parameters; older builds used a form body.
        const params = new URL(url, location.href).searchParams;
        const bodyParams = value instanceof FormData || value instanceof URLSearchParams ? value : new URLSearchParams(value);
        for (const [key, entry] of bodyParams) params.set(key, entry);
        if (!params.has('room_id')) throw new Error('点赞上报缺少房间号，格式可能已变化。');
        if (String(params.get('room_id')) !== task.roomId) { ignored = true; return; }
        count = Number(params.get('click_time'));
        if (!Number.isSafeInteger(count) || count <= 0 || count > 300) throw new Error('点赞上报格式发生变化。');
        task.submitted += count;
        // The native handler can start a report before its Promise resolves.
        if (task.submitted > task.likes + 1) throw new Error('发现额外点赞或重复上报，请停止手动点赞并刷新。');
      }).catch(error => { if (active) task.failure = error; });
      return async (response, error) => {
        if (finished) return;
        finished = true;
        try {
          await ready;
          if (!active || ignored || task.failure) return;
          if (error) throw new Error('点赞上报网络异常，结果未知；不会自动重试。');
          if (!response.ok) throw new Error('点赞上报 HTTP 错误，结果未知。');
          const data = await response.json();
          if (!data || data.code !== 0) throw new Error(`点赞上报失败：${data?.message || data?.msg || data?.code || '未知错误'}`);
          if (!active) return;
          task.reported += count;
          updateCounts(task);
        } catch (failure) {
          if (active) task.failure = failure;
        } finally { task.inflight--; }
      };
    }
    function wrappedFetch(input, init) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const method = init?.method || input?.method || 'GET';
      if (!active || !relevant(url, method)) return originalFetch.apply(this, arguments);
      let body;
      try { body = init?.body ?? (typeof input.clone === 'function' ? input.clone().text() : ''); }
      catch (error) { body = Promise.reject(error); }
      const finish = ticket(url, body);
      try {
        return originalFetch.apply(this, arguments).then(response => {
          try { void finish(response.clone()); } catch (error) { void finish(null, error); }
          return response;
        }, error => { void finish(null, error); throw error; });
      } catch (error) { void finish(null, error); throw error; }
    }
    function wrappedOpen(method, url) {
      requests.set(this, { method: String(method), url: String(url) });
      return originalOpen.apply(this, arguments);
    }
    function wrappedSend(body) {
      const request = requests.get(this);
      if (active && request && relevant(request.url, request.method)) {
        const finish = ticket(request.url, body);
        this.addEventListener('loadend', () => {
          void finish({ ok: this.status >= 200 && this.status < 300,
            json: async () => this.responseType === 'json' ? this.response : JSON.parse(this.responseText) });
        }, { once: true });
        try { return originalSend.apply(this, arguments); }
        catch (error) { void finish(null, error); throw error; }
      }
      return originalSend.apply(this, arguments);
    }
    if (typeof originalFetch === 'function') window.fetch = wrappedFetch;
    proto.open = wrappedOpen; proto.send = wrappedSend;
    return () => {
      active = false;
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      if (proto.open === wrappedOpen) proto.open = originalOpen;
      if (proto.send === wrappedSend) proto.send = originalSend;
    };
  }
  function assertActive(task) {
    if (task.controller.signal.aborted) throw new Error('已停止。');
    if (task.failure) throw task.failure;
    if (location.pathname !== task.path) throw new Error('已切换房间，任务停止。请刷新页面后重新开始。');
  }
  function sleep(ms, task) {
    assertActive(task);
    return new Promise((resolve, reject) => {
      const signal = task.controller.signal;
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, Math.max(0, ms));
      function cancel() {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        reject(new Error('已停止。'));
      }
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  async function waitUntil(predicate, timeout, message, task) {
    const started = Date.now();
    let deadline = started + timeout;
    while (!predicate()) {
      assertActive(task);
      // Hidden tabs can batch timers. Allow a longer, still bounded wait;
      // never schedule catch-up actions or reset the deadline on each poll.
      if (document.hidden) deadline = Math.max(deadline, started + BACKGROUND_WAIT);
      if (Date.now() >= deadline) throw new Error(message);
      await sleep(50, task);
    }
    assertActive(task);
  }
  async function sendMessage(task) {
    assertActive(task);
    checkNative(task);
    const vm = task.vm;
    if (vm.chatInput || vm.customChatInput || vm.atUserName) throw new Error('输入框中已有草稿或回复对象，请手动处理后再开始。');
    if (!vm.allowSendingDanmaku || vm.isUserBlocked || vm.isBlockPanelOpen) throw new Error('当前不能发送弹幕，请检查禁言或发送冷却。');
    if (vm.isNeedVerification) throw new Error('直播间要求验证，请先手动完成验证后再开始。');
    const { emoji, number } = randomMessage(task.emojis);
    if (emoji) {
      status(`正在发送 ${emoji.emoji || '表情'}`);
      await postMessage(task.roomId, number, task, task.mixin, task.csrf, emoji);
      task.messages++;
      updateCounts(task);
      return;
    }
    task.sendPending = true;
    task.lastMessageAt = Date.now();
    let confirmed = false;
    status(`正在发送数字 ${number}`);
    // The native method's Promise is NOT the server acknowledgement.
    Promise.resolve(vm.sendDanmaku(null, String(number), null, false, () => {
      if (job === task && !task.controller.signal.aborted) confirmed = true;
    })).catch(error => { task.failure = error; });
    await waitUntil(() => confirmed, 20000, '弹幕确认超时，请检查直播页提示；不会自动重发。', task);
    task.sendPending = false;
    task.messages++;
    updateCounts(task);
  }
  async function like(task) {
    assertActive(task);
    checkNative(task);
    const vm = task.vm;
    if (!vm.isShowLikeBtn) throw new Error('当前房间未开放点赞。');
    const interval = likeInterval(vm);
    el('rate').textContent = `点赞间隔 ${interval} 毫秒`;
    await waitUntil(() => !vm.likeBtnClickIsCoolingDown && task.inflight === 0 &&
      (task.lastLikeAt === null || Date.now() - task.lastLikeAt >= likeInterval(vm)),
    30000, '点赞冷却或上报等待超时，已停止。', task);
    assertActive(task);
    checkNative(task);
    const before = vm.localSingleReportIntervalLikeNum;
    const submitted = task.submitted;
    task.nativePending = true;
    task.lastLikeAt = Date.now();
    let settled = false;
    Promise.resolve(vm.handleLikeBtnClick()).then(() => { settled = true; }, error => { task.failure = error; });
    await waitUntil(() => settled, 10000, '内置点赞方法超时，结果未知。', task);
    if (!vm.likeBtnClickIsCoolingDown && vm.localSingleReportIntervalLikeNum <= before && task.submitted === submitted) {
      task.nativePending = false;
      throw new Error('页面未接收本次点赞，已停止；不会自动重试。');
    }
    task.nativePending = false;
    task.likes++;
    updateCounts(task);
    status('正在点赞');
  }
  async function drainReports(task) {
    status('等待点赞上报');
    await waitUntil(() => task.reported === task.likes && task.inflight === 0 && task.vm.localSingleReportIntervalLikeNum === 0,
      30000, '点赞上报确认超时，结果未知；不会自动重试。', task);
  }
  function md5Ascii(value) {
    const length = value.length;
    const bytes = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
    for (let i = 0; i < length; i++) bytes[i] = value.charCodeAt(i);
    bytes[length] = 128;
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 8, (length * 8) >>> 0, true);
    view.setUint32(bytes.length - 4, Math.floor(length / 0x20000000), true);
    const shift = [7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21];
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let block = 0; block < bytes.length; block += 64) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g, rotate;
        if (i < 16) { f = (b & c) | (~b & d); g = i; rotate = shift[i % 4]; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; rotate = shift[4 + i % 4]; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; rotate = shift[8 + i % 4]; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; rotate = shift[12 + i % 4]; }
        const sum = (a + f + view.getUint32(block + g * 4, true) + Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)) >>> 0;
        const next = (b + ((sum << rotate) | (sum >>> (32 - rotate)))) >>> 0;
        a = d; d = c; c = b; b = next;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    return [a0,b0,c0,d0].map(word => [0,8,16,24].map(bits => ((word >>> bits) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }
  function signedUrl(path, fields, mixin) {
    const params = { ...fields, wts: String(Math.round(Date.now() / 1000)) };
    const query = Object.keys(params).sort().filter(key => params[key] != null)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]).replace(/[!'()*]/g, ''))}`).join('&');
    const url = new URL(path, API);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('w_rid', md5Ascii(query + mixin));
    return url;
  }
  async function requestJson(url, init, task) {
    assertActive(task);
    task.pendingRequest = init.method === 'POST';
    const response = await fetch(url, { credentials: 'include', signal: task.controller.signal, ...init });
    if (!response.ok) throw new Error(`接口 HTTP ${response.status}，请求结果未知。`);
    const data = await response.json();
    task.pendingRequest = false;
    assertActive(task);
    if (data?.code !== 0) throw new Error(data?.message || data?.msg || `接口返回 ${data?.code ?? '异常'}`);
    return data.data;
  }
  function renderMedals() {
    const list = el('medal-list');
    list.replaceChildren();
    for (const medal of medals) {
      const row = document.createElement('li');
      row.textContent = `${medal.name} · 房间 ${medal.roomId} · ${medal.state}`;
      list.appendChild(row);
    }
    const live = medals.filter(medal => medal.live).length;
    el('medal-summary').textContent = `房间 ${medals.length} · 已开播 ${live} · 未开播 ${medals.length - live}`;
    el('medal-rooms').hidden = medals.length === 0;
  }
  async function scanMedals() {
    if (job) return;
    const task = { controller: new AbortController(), path: location.pathname, failure: null, pendingRequest: false };
    job = task; medals = []; setBusy(true);
    el('medal-summary').textContent = '正在读取粉丝牌…';
    el('medal-list').replaceChildren();
    el('medal-rooms').hidden = true;
    try {
      const { vm } = findNative();
      if (!vm.isLogin) throw new Error('请先登录直播间。');
      const roomId = vm.$store?.getters?.baseInfoRoom?.roomID;
      const targetId = vm.$store?.getters?.baseInfoAnchor?.uid;
      if (!/^\d+$/.test(String(roomId)) || !/^\d+$/.test(String(targetId))) throw new Error('无法读取当前房间或主播标识。');
      const found = new Map();
      for (let page = 1; page <= 100; page++) {
        status(`正在读取粉丝牌第 ${page} 页…`);
        const url = new URL('/xlive/app-ucenter/v1/fansMedal/panel', API);
        url.search = new URLSearchParams({ page: String(page), page_size: '10', room_id: String(roomId), target_id: String(targetId) });
        const data = await requestJson(url, { method: 'GET' }, task);
        if (!data || !Number.isSafeInteger(Number(data.total_number))) throw new Error('粉丝牌列表格式发生变化。');
        for (const item of [...(data.special_list || []), ...(data.list || [])]) {
          const id = String(item.room_info?.room_id || item.room_id || '');
          const anchorId = String(item.medal?.target_id || item.anchor_info?.uid || item.target_id || '');
          if (!/^\d+$/.test(id) || !/^\d+$/.test(anchorId)) continue;
          if (!found.has(id)) found.set(id, { roomId: id, anchorId,
            name: String(item.anchor_info?.nick_name || item.medal?.medal_name || id),
            live: Number(item.room_info?.living_status ?? item.living_status) === 1,
            state: '待处理' });
        }
        if (page * 10 >= Number(data.total_number)) break;
        if (page === 100) throw new Error('粉丝牌分页超过上限，已停止。');
      }
      medals = [...found.values()];
      el('medal-rooms').open = true;
      renderEmojiRooms();
      for (const medal of medals) if (!medal.live) medal.state = '未开播，待尝试';
      renderMedals();
      status(`已读取 ${medals.length} 个房间`);
    } catch (error) {
      medals = [];
      el('medal-summary').textContent = '读取失败';
      status(error.message || '读取粉丝牌失败。');
    } finally { job = null; setBusy(false); }
  }
  async function wbiMixin(task) {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav',
      { credentials: 'include', signal: task.controller.signal });
    if (!response.ok) throw new Error('无法获取请求签名参数。');
    const data = await response.json();
    const image = data?.data?.wbi_img;
    const key = url => String(url || '').split('/').pop().split('.')[0];
    const combined = key(image?.img_url) + key(image?.sub_url);
    if (!/^[a-f0-9]{64}$/i.test(combined)) throw new Error('请求签名参数格式发生变化。');
    return WBI_TAB.map(index => combined[index]).join('').slice(0, 32);
  }
  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]*)/);
    if (!match) throw new Error('未找到登录凭据，请重新登录直播间。');
    return decodeURIComponent(match[1]);
  }
  async function readMedalTask(medal, task, csrf) {
    const url = new URL('/xlive/app-ucenter/v1/fansMedal/GetActivatedMedalInfo', API);
    url.search = new URLSearchParams({ csrf, platform: 'pc', room_id: medal.roomId, scene: 'club',
      target_id: medal.anchorId, web_location: '444.260', _t: String(Date.now()) });
    const data = await requestJson(url, { method: 'GET', cache: 'no-store' }, task);
    if (typeof data?.is_lighted !== 'boolean' || !Array.isArray(data.task_info)) throw new Error('粉丝牌任务格式发生变化。');
    if (!data.is_lighted) return { lighted: false, messages: 0, likes: 0 };
    function progress(title) {
      const entry = data.task_info.find(item => item.title === title);
      const match = entry?.sub_title?.match(/每日上限\s*(\d+)\s*\/\s*(\d+)/);
      if (!match || Number(match[2]) !== 10) throw new Error(`${title}任务格式发生变化。`);
      const value = Number(match[1]);
      if (!Number.isSafeInteger(value) || value < 0 || value > 10) throw new Error(`${title}任务进度异常。`);
      return value;
    }
    return { lighted: true, messages: progress('发弹幕'), likes: progress('点赞30次') };
  }
  function syncMedalCounts(progress, task) {
    task.messages = progress.messages;
    task.likes = progress.likes * 30;
    updateCounts(task);
  }
  async function sendMedalMessage(medal, task, mixin, csrf) {
    if (task.lastMessageAt !== null) await sleep(Math.max(0, MESSAGE_INTERVAL - (Date.now() - task.lastMessageAt)), task);
    assertActive(task);
    const { emoji, number } = randomMessage(task.roomEmojis);
    status(`${medal.name}：发送${emoji ? `表情 ${emoji.emoji || ''}` : `数字 ${number}`}。`);
    await postMessage(medal.roomId, number, task, mixin, csrf, emoji);
  }
  async function postMessage(roomId, number, task, mixin, csrf, emoji) {
    assertActive(task);
    task.lastMessageAt = Date.now();
    const body = new URLSearchParams({ bubble: '0', msg: emoji ? emoji.emoticon_unique : String(number), color: '16777215', fontsize: '25', mode: '1',
      rnd: String(Math.floor(Date.now() / 1000)), roomid: roomId, data_extend: '{}', csrf, csrf_token: csrf });
    if (emoji) body.set('dm_type', '1');
    await requestJson(signedUrl('/msg/send', {}, mixin),
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body }, task);
  }
  async function reportMedalLikes(medal, task, mixin, csrf) {
    for (let batch = 0; batch < 2; batch++) {
      for (let click = 0; click < 15; click++) {
        if (task.lastLikeAt !== null) await sleep(Math.max(0, 400 - (Date.now() - task.lastLikeAt)), task);
        assertActive(task);
        task.lastLikeAt = Date.now();
      }
      status(`${medal.name}：上报本轮第 ${task.reported + 1}–${task.reported + 15} 次点赞。`);
      const url = signedUrl(REPORT_PATH, { click_time: '15', room_id: medal.roomId, uid: task.uid,
        anchor_id: medal.anchorId, web_location: '444.8', csrf }, mixin);
      await requestJson(url, { method: 'POST' }, task);
      task.reported += 15;
      updateCounts(task);
    }
  }
  async function verifyMedalProgress(medal, task, csrf, previous, required) {
    await sleep(500, task);
    let next = await readMedalTask(medal, task, csrf);
    const advanced = () => next.lighted && required.every(key => next[key] > previous[key]);
    if (!advanced()) {
      await sleep(1500, task);
      next = await readMedalTask(medal, task, csrf);
    }
    if (!advanced()) {
      task.progressMismatch = true;
      throw new Error(`${medal.name} 的${required.includes('likes') ? '点赞' : '弹幕'}未计入粉丝牌任务，已停止。`);
    }
    syncMedalCounts(next, task);
    return next;
  }
  async function runMedalRoom(medal, task, mixin, csrf) {
    task.messages = 0; task.likes = 0; task.reported = 0;
    el('reported-target').textContent = '300';
    updateCounts(task);
    medal.state = '读取任务进度'; renderMedals();
    let progress = await readMedalTask(medal, task, csrf);
    syncMedalCounts(progress, task);
    el('reported-target').textContent = String(medal.live ? (10 - progress.likes) * 30 + Number(!progress.lighted) * 30 : 0);
    if (progress.lighted && progress.messages === 10 && progress.likes === 10) {
      medal.state = '任务已完成，跳过'; renderMedals(); return;
    }
    task.roomEmojis = (progress.messages < 10 && (progress.lighted || medal.live)) ?
      await resolveEmojis(medal.roomId, task.emojiRooms, task) : [];
    if (!progress.lighted) {
      if (!medal.live) { medal.state = '未开播且未点亮，待开播'; renderMedals(); return; }
      medal.state = '先点亮粉丝牌'; renderMedals();
      await reportMedalLikes(medal, task, mixin, csrf);
      await sleep(500, task);
      progress = await readMedalTask(medal, task, csrf);
      if (!progress.lighted) {
        await sleep(1500, task);
        progress = await readMedalTask(medal, task, csrf);
      }
      if (!progress.lighted) {
        task.progressMismatch = true;
        throw new Error(`${medal.name} 的粉丝牌未点亮，已停止。`);
      }
      syncMedalCounts(progress, task);
    }
    medal.state = '执行中'; renderMedals();
    if (!medal.live) {
      while (progress.messages < 10) {
        await sendMedalMessage(medal, task, mixin, csrf);
        progress = await verifyMedalProgress(medal, task, csrf, progress, ['messages']);
      }
      medal.state = progress.likes === 10 ? '任务已完成' : '弹幕已完成，点赞待开播';
      renderMedals(); return;
    }
    while (progress.messages < 10 || progress.likes < 10) {
      const required = [];
      const sendNext = progress.messages < 10 && progress.messages <= progress.likes;
      if (sendNext) {
        await sendMedalMessage(medal, task, mixin, csrf);
        required.push('messages');
      }
      if (progress.likes < 10 && progress.likes < progress.messages + Number(sendNext)) {
        await reportMedalLikes(medal, task, mixin, csrf);
        required.push('likes');
      }
      progress = await verifyMedalProgress(medal, task, csrf, progress, required);
    }
    medal.state = '任务已完成'; renderMedals();
  }
  async function startMedals() {
    if (job || medals.length === 0) return;
    if (needsReload) { status('上次任务有结果未确认，请刷新直播间后再开始。'); return; }
    const task = { controller: new AbortController(), path: location.pathname, failure: null, pendingRequest: false,
      messages: 0, likes: 0, reported: 0, lastMessageAt: null, lastLikeAt: null, uid: '', emojiRooms: new Set(emojiRooms) };
    job = task; setBusy(true);
    el('rate').textContent = '点赞间隔 400 毫秒，每 15 次上报';
    try {
      const { vm } = findNative();
      if (!vm.isLogin) throw new Error('请先登录直播间。');
      task.uid = String(vm.$store?.getters?.baseInfoUser?.uid || '');
      if (!/^\d+$/.test(task.uid)) throw new Error('无法读取当前登录用户标识。');
      const csrf = csrfToken();
      const mixin = await wbiMixin(task);
      for (const medal of [...medals.filter(item => item.live), ...medals.filter(item => !item.live)]) {
        await runMedalRoom(medal, task, mixin, csrf);
      }
      assertActive(task);
      const pending = medals.filter(medal => medal.state.includes('待开播')).length;
      status(pending ? `已处理全部粉丝牌房间；${pending} 个未开播房间的任务仍待开播。` :
        '粉丝牌房间任务已完成，已从任务接口确认进度。');
    } catch (error) {
      needsReload ||= task.pendingRequest || task.progressMismatch;
      const current = medals.find(medal => ['读取任务进度', '先点亮粉丝牌', '执行中'].includes(medal.state));
      if (current) current.state = task.pendingRequest ? '结果未知，待核对' : '失败，待核对';
      renderMedals();
      status(`${error.message || '任务出错，已停止。'}${needsReload ? ' 存在未确认操作，请核对任务后刷新。' : ''}`);
    } finally { job = null; setBusy(false); }
  }
  async function start(mode) {
    if (job) return;
    if (needsReload) { status('上次任务有结果未确认，请刷新直播间后再开始。'); return; }
    const task = { controller: new AbortController(), path: location.pathname, messages: 0,
      likes: 0, reported: 0, submitted: 0, inflight: 0, lastMessageAt: null, lastLikeAt: null,
      sendPending: false, nativePending: false, failure: null };
    job = task;
    setBusy(true);
    el('reported-target').textContent = '300';
    updateCounts(task);
    let cleanup = () => {};
    try {
      Object.assign(task, findNative());
      checkNative(task);
      task.roomId = String(task.vm.$store?.getters?.baseInfoRoom?.roomID || '');
      if (!/^\d+$/.test(task.roomId)) throw new Error('无法识别真实房间号，请刷新。');
      if (mode !== 'likes' && emojiRooms.has(task.roomId)) {
        task.emojis = await resolveEmojis(task.roomId, emojiRooms, task);
        task.csrf = csrfToken();
        task.mixin = await wbiMixin(task);
      }
      if (mode !== 'messages') {
        likeInterval(task.vm);
        if (task.vm.localSingleReportIntervalLikeNum !== 0) throw new Error('页面已有待上报的点赞，请等待其完成后再开始。');
        cleanup = observeReports(task);
      }
      if (mode !== 'likes') {
        for (let number = 1; number <= 10; number++) {
          if (task.lastMessageAt !== null) await waitUntil(() => Date.now() - task.lastMessageAt >= MESSAGE_INTERVAL,
            MESSAGE_INTERVAL + 1000, '弹幕间隔等待超时。', task);
          await sendMessage(task);
          if (mode === 'all') {
            for (let count = 0; count < 30; count++) await like(task);
            await drainReports(task);
          }
        }
      } else {
        for (let count = 0; count < 300; count++) await like(task);
        await drainReports(task);
      }
      assertActive(task);
      status('执行完毕');
    } catch (error) {
      needsReload = task.pendingRequest || task.sendPending || task.nativePending || task.inflight > 0 || task.likes > task.reported;
      status(`${error.message || '任务出错，已停止。'}${needsReload ? ' 存在未确认操作，请刷新后再开始。' : ''}`);
    } finally {
      cleanup();
      job = null;
      setBusy(false);
    }
  }
  el('start').addEventListener('click', () => { void start('all'); });
  el('danmaku-only').addEventListener('click', () => { void start('messages'); });
  el('likes-only').addEventListener('click', () => { void start('likes'); });
  el('scan-medals').addEventListener('click', () => { void scanMedals(); });
  el('start-medals').addEventListener('click', () => { void startMedals(); });
  el('load-emojis').addEventListener('click', () => { void loadEmojis(); });
  el('emoji-room').addEventListener('change', () => {
    if (job) return;
    displayedEmojis = [];
    try { renderEmojis(); } catch (error) { status(error.message); }
  });
  el('message-type').addEventListener('change', () => {
    if (job) return;
    try {
      const roomId = emojiRoomId();
      if (el('message-type').value === 'emoji') emojiRooms.add(roomId);
      else emojiRooms.delete(roomId);
      renderEmojis();
    } catch (error) { status(error.message); }
  });
  el('stop').addEventListener('click', () => {
    job?.controller.abort();
    status('已停止新增操作；页面已排队的请求可能仍会上报。');
    if (!job) setBusy(false);
  });
  el('collapse').addEventListener('click', () => {
    finishResize?.();
    setCollapsed(!panelPrefs.collapsed);
  });
  el('check-native').addEventListener('click', () => {
    try {
      const { vm } = findNative();
      status(`已识别内置接口；${vm.isLogin ? '已登录' : '尚未登录'}。点赞间隔至少 ${likeInterval(vm)} 毫秒。`);
    } catch (error) { status(error.message); }
  });
  window.addEventListener('pagehide', () => job?.controller.abort());
})();
