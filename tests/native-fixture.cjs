// Model of the observed Vue contract, with local transport and no live traffic.
function installNativeFixture(w, options = {}) {
  const messages = [], likes = [], reports = [], domEvents = [];
  const root = w.document.getElementById('chat-control-panel-vm');
  const input = root.querySelector('textarea');
  const opts = { cooldown: 0.35, reportLimit: 15, reportDelay: 80, sendDelay: 100, ...options };
  let reportTimer = null;
  w.fetch = (url, init) => new Promise((resolve, reject) => {
    const count = Number(new w.URLSearchParams(init.body).get('click_time') || new w.URL(url).searchParams.get('click_time'));
    reports.push({ count, at: w.Date.now() });
    w.setTimeout(() => {
      if (opts.networkError) return reject(new Error('offline'));
      resolve(new w.Response(JSON.stringify({ code: opts.reportCode || 0, message: opts.reportCode ? '请求过于频繁' : '' }), { status: 200 }));
    }, opts.reportDelay);
  });
  const vm = {
    isLogin: true, isShowLikeBtn: true, allowSendingDanmaku: true,
    isUserBlocked: false, isBlockPanelOpen: false, isNeedVerification: false,
    chatInput: options.draft || '', atUserName: '', customChatInput: '',
    likeBtnClickFrequencyLimit: opts.cooldown, likeBtnClickIsCoolingDown: false,
    likeBtnClickMaxTimeInterval: 6, localSingleReportIntervalLikeNum: 0,
    $children: [], $store: { getters: { baseInfoRoom: { roomID: 999, shortRoomID: 123 } } },
    async sendDanmaku(event, text, validation, special, success) {
      if (!this.isLogin || !this.allowSendingDanmaku) return null;
      messages.push({ value: this.chatInput || text, at: w.Date.now(), likesBefore: likes.length });
      this.chatInput = '';
      if (!opts.noSendAck) w.setTimeout(success, opts.sendDelay);
      // The real method returns before the HTTP request completes.
    },
    async handleLikeBtnClick() {
      if (!this.isLogin || this.likeBtnClickIsCoolingDown || opts.ignoreLike) return;
      this.likeBtnClickIsCoolingDown = true;
      w.setTimeout(() => { this.likeBtnClickIsCoolingDown = false; }, this.likeBtnClickFrequencyLimit * 1000);
      likes.push({ at: w.Date.now() });
      this.localSingleReportIntervalLikeNum++;
      if (!reportTimer) reportTimer = w.setTimeout(report, 6000);
      if (this.localSingleReportIntervalLikeNum >= opts.reportLimit) report();
    },
  };
  async function report() {
    w.clearTimeout(reportTimer); reportTimer = null;
    const count = vm.localSingleReportIntervalLikeNum;
    if (!count) return;
    try {
      let url = 'https://api.live.bilibili.com/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3';
      const params = new w.URLSearchParams({ room_id: '999', click_time: String(count) });
      if (opts.reportInQuery) url += '?' + params;
      const body = opts.reportInQuery ? undefined : params;
      const response = opts.useXHR ? await new Promise((resolve, reject) => {
        const xhr = new w.XMLHttpRequest();
        xhr.open('POST', url);
        xhr.responseType = 'json';
        xhr.onload = () => resolve(new w.Response(JSON.stringify(xhr.response), { status: xhr.status }));
        xhr.onerror = reject;
        xhr.send(body);
      }) : await w.fetch(url, { method: 'POST', body });
      const data = await response.json();
      if (data.code === 0) vm.localSingleReportIntervalLikeNum = 0;
    } catch { /* Native page logs failure; helper must detect it separately. */ }
  }
  input.value = options.draft || '';
  for (const type of ['input', 'change', 'keydown', 'keyup', 'click']) root.addEventListener(type, e => domEvents.push(e.type));
  w.document.addEventListener('keydown', e => { if (e.code === 'KeyK') domEvents.push('K'); });
  root.__vue__ = vm;
  return { vm, input, messages, likes, reports, domEvents, opts };
}
if (typeof module !== 'undefined') module.exports = { installNativeFixture };
else window.installNativeFixture = installNativeFixture;
