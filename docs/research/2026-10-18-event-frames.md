# 赛事专题页的内嵌直播组件

2026-10-18 在独立、未登录的 Edge 中检查用户报告的[第五人格赛事直播间](https://live.bilibili.com/1713546334)，并对比[英雄联盟赛事直播间](https://live.bilibili.com/6)。所有非只读请求在浏览器出网前拦截。

两个房间的顶层页面均为活动专题页，顶层文档没有 `chat-control-panel-vm`。真正的聊天组件位于同源 iframe 中：

- `1713546334` → `/blanc/1713546334?liteVersion=true`
- `6` → `/blanc/7734200?liteVersion=true`（短房间号与真实房间号不同）

第五人格房间的内嵌文档中，`chat-control-panel-vm.__vue__` 仍提供 `sendDanmaku`、`handleLikeBtnClick`、原有发送状态和 Vuex 房间信息；点赞冷却为 0.35 秒。问题源于脚本只查找顶层文档，并且只包装顶层的 fetch/XHR。

1.6.1 每次检测时先查找当前文档，再检查同源且路径为数字房间号或 `/blanc/数字房间号` 的 iframe。跳过不可访问及无关的内嵌页面，不缓存尚未加载的结果。保留单个顶层助手面板及 `@noframes`。点赞监听使用组件根节点的 `ownerDocument.defaultView` 中的 fetch 和 XMLHttpRequest，任务结束或停止时恢复原方法；处理该页面创建的 URL 和 FormData/URLSearchParams。

五项本地回归测试覆盖发送后确认 30 赞再发送下一条、延迟加载后重新检测、忽略不可访问/无关页面、移除内嵌直播页后停止，以及内嵌窗口变得不可访问时停止并恢复控件。Edge 模拟页面额外验证内嵌 XHR 上报、监听清理，以及实际跨域跳转后停止。跨域后访问旧 WindowProxy 的 fetch 会抛出 SecurityError，因此监听恢复单独处理该情况，任务清理始终重置忙碌状态。

真实页面兼容性探针已在 `1713546334` 捕获到 `likeReportV3` POST，字段位于查询串（包括 `click_time`、`room_id`、`uid`、`anchor_id`、`web_location`、`w_rid`、`wts`），使用本地 `code: 0` 回执后助手确认 15 次点赞。此次仅验证页面接口兼容性，没有真实发弹幕、点赞或验证亲密度到账。
