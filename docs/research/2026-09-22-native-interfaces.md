# 直播间内置接口探索（2026-09-22）

结论：可以不操作输入框、不模拟 K 键。当前直播页既有可访问的组件方法，也有对应 HTTP 接口；但组件方法并不都返回服务端确认，直接发 HTTP 请求也不能保证亲密度到账。

## 验证范围

- 从 B 站直播页及其官方 CDN 获取当前 JavaScript，静态追踪调用链。
- 使用独立、未登录的 Edge 会话打开 `https://live.bilibili.com/6`，只读取组件方法与配置。拦截所有非 GET/HEAD/OPTIONS 请求，没有调用弹幕或点赞方法，没有使用用户浏览器的登录凭据。
- 运行时确认：`document.getElementById('chat-control-panel-vm').__vue__` 上存在 `sendDanmaku`、`handleLikeBtnClick`、`startLikeBtnClickReportTimer`。详见同目录 `runtime-probe.json`。
- 此结果来自抽样房间，不代表用户所在房间的配置完全相同；未验证登录后的请求成功或亲密度到账。本轮没有修改现有油猴脚本。

## 两层入口

| 操作 | 页面内方法 | 实际网络入口 |
| --- | --- | --- |
| 弹幕 | 聊天组件 `sendDanmaku` → 播放器 `sendDanmaku` | `POST https://api.live.bilibili.com/msg/send` |
| 点赞 | 聊天组件 `handleLikeBtnClick` → 累计本地数量 → 上报 | `POST https://api.live.bilibili.com/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3` |

### 弹幕

当前播放器发送逻辑补全 `roomid`、`rnd`、`color`、`fontsize`、`mode`、`data_extend` 等字段，带上 `msg`。请求层使用登录 Cookie，补入 `bili_jct` 对应的 `csrf` / `csrf_token`，并启用 WBI 查询参数签名。因此不能把旧示例里的几个字段拼成 POST 就当作完整复现。

聊天组件方法的参数形状是 `sendDanmaku(event, text, validateInfo, specialMode, successCallback)`。需要特别注意：

- 普通模式优先使用组件已有草稿，且会清空输入内容；直接传入数字未必发送该数字。需要处理草稿保护，或走更下层的播放器入口。
- 方法内部发起请求但没有等待其完成，所以仅 `await` 该方法不能当成发送成功。第五个参数的回调是在检查返回码后调用；错误路径显示页面提示，还需配套超时和错误处理。
- 播放器入口可取得响应，但初始化用的 `window.__PLAYER_GLOBAL_INSTANCE__` 随后会被删除，不能假设它一直可用。Webpack 模块编号也不应作为长期稳定接口。

### 点赞

上报载荷包括 `click_time`（累计点击次数）、`room_id`、`uid`、`anchor_id`、`web_location`。页面会在数量达到配置阈值，或定时器到期时上报。抽样房间当前配置为：

- `cooldown = 0.35`：每次有效点击后冷却 350 毫秒。
- `report_click_limit = 15`：本地累计达到 15 次时触发上报。
- `report_time_min = 5`、`report_time_max = 10`：在 5–10 秒范围选择定时上报时机。

键盘 K 的监听器只是调用 `handleLikeBtnClick`。方法发现仍在冷却时直接返回，甚至不会增加本地待上报数量。因此即使改成直接调用这个方法，也仍需遵守冷却。

现有脚本每 334 毫秒触发一次 K，小于本次观测到的 350 毫秒。若目标房间配置相同，就会有部分调用被页面忽略。这是“按键计数满了但点赞不足”的一种明确机制；尚不能据此断言用户房间的全部漏计都源于它。

## 后续改造建议

1. 保留“一个数字 + 30 次点赞”的顺序、停止按钮和折叠位置。
2. 优先复用页面请求能力，让它处理登录、签名与页面提示；按接口响应或成功回调记账，不能把方法返回或本地动画直接视为到账。
3. 点赞频率取“用户指定每秒最多 3 次”与当前房间冷却中更慢者，再加少量调度余量；若冷却为 350ms，可以用约 370–400ms。
4. 若直接调用点赞 HTTP 接口，需要实测单次与分批请求的服务端限制，不能假定 `click_time=30` 一次请求就会获得 30 次有效任务进度。该字段只证明页面支持累计上报。
5. 等待最终一批上报完成后再结束任务；验证时以粉丝团任务实际进度为准。网络状态不明时不要盲目重试，避免重复发送。

## 一手来源

- [直播页面](https://live.bilibili.com/6)
- [聊天组件与点赞上报实现](https://s1.hdslb.com/bfs/static/blive/blfe-live-room/static/js/9649.1063b9e512e83582c1bc.js)：`reportUserLikeBtnClickTimes`、`handleLikeBtnClick`、`sendDanmaku`、`bindHotKeyToLikeBtn`。
- [播放器与弹幕请求实现](https://s1.hdslb.com/bfs/static/bilibili-live-player/room-player.01626800.prod.min.js)：`/msg/send`、`wbi: true`、凭据与 CSRF 处理。
- [页面主程序](https://s1.hdslb.com/bfs/static/blive/blfe-live-room/static/js/app.3b48f866e1563d25d39c.js)：播放器实例生命周期与 HTTP 请求封装。

这些是本次抓取的页面内部实现，属于可能随更新变化的私有接口，不是稳定的公开 SDK。

## 1.1.0 实施补充

已将脚本切换到上述组件方法，并通过成功回调确认弹幕、观察页面的 fetch/XHR 回执确认点赞上报。独立 Edge 中的真实页面测试（点赞请求全部本地拦截）发现，当前 `likeReportV3` 请求的字段放在 URL 查询串中，请求体为空，查询字段包括 `click_time`、`room_id`、`uid`、`anchor_id`、`web_location`、`w_rid`、`wts`。脚本因此同时解析查询串和表单请求体；签名仍由页面负责。

通过本地模拟响应验证了真实组件到上报观察器的调用链，没有向服务端发送点赞。测试脚本为 `tests/live-native-smoke.cjs`。实际账号的服务端接受情况及亲密度到账仍需用户在直播间确认。

## 1.2.0 跨房间补充（2026-09-23）

直播页当前粉丝牌组件调用 `GET /xlive/app-ucenter/v1/fansMedal/panel`，参数为 `page`、`page_size`、当前 `room_id` 和 `target_id`。返回的 `data.list`、`data.special_list` 可合并，`data.total_number` 用于翻页；条目包含 `room_info.room_id`、`room_info.living_status`、`medal.target_id` 和 `anchor_info.nick_name`。组件本身只展示前 10 条，脚本改为读取全部分页并按房间号去重。

直播播放器的 WBI 代码使用 `img_key + sub_key` 经过固定位置表生成混合密钥，给已排序的查询参数加入 `wts` 后计算 MD5，得到 `w_rid`。`GET https://api.bilibili.com/x/web-interface/nav` 可提供当前密钥；在未登录的独立 Edge 页面中，该接口返回 `code: -101` 但仍包含 `data.wbi_img`。粉丝牌接口同样允许直播页跨域发起请求，未登录时返回 `code: -101`。这些只读测试未使用用户登录态。

1.2.0 版跨房间脚本根据上述字段直接向目标房间发起 `/msg/send` 和 `likeReportV3` 请求，按每 400 毫秒一次计时，累计 15 次后上报一次。当时只用模拟响应验证，真实账号测试结果及随后修正见下节。

## 1.3.0 登录账号实测（2026-09-23）

用户授权后，在其已登录的 Edge 直播页做了少量真实操作，并通过页面同源只读接口核对任务。未运行整批粉丝牌任务，也未输出或保存 Cookie 内容。

- 粉丝牌面板返回 11 个房间，其中 2 个开播。直播页粉丝团面板所用的 `GET /xlive/app-ucenter/v1/fansMedal/GetActivatedMedalInfo` 接口可按目标 `room_id`、`target_id` 查询任务，参数还包括 `csrf`、`platform=pc`、`scene=club`、`web_location=444.260`。返回 `is_lighted`、`task_info`；已点亮房间的任务项 `sub_title` 包含 `每日上限 n/10`。
- 初版跨房间点赞请求缺少 URL 查询参数 `csrf`，服务端返回 `-111 CSRF 校验失败`。抓取页面原生的一次点赞上报，确认其查询参数为 `click_time`、`room_id`、`uid`、`anchor_id`、`web_location`、`csrf`、`w_rid`、`wts`；修正后目标房间两批各 15 次点赞均返回 `code: 0`。
- 已开播目标房间的粉丝牌起初未点亮，单条数字弹幕请求 `code: 0`，亲密度与每日任务未增长。30 次点赞后粉丝牌点亮，但每日弹幕、点赞任务仍为 0/10。点亮后再发一条数字弹幕并点赞 30 次，任务计数分别增长到 1/10；因此点亮用的 30 赞不能当作每日任务的首轮点赞。
- 一个未开播且已点亮的粉丝牌房间，数字弹幕请求成功并使弹幕任务增长到 1/10；30 次点赞上报虽返回 `code: 0`，点赞任务仍为 0/10。因此脚本只在未开播房间补弹幕，将点赞留待开播。

这些观测来自少量房间和单次测试。脚本 1.3.0 改为读取服务端任务进度，跳过已完成任务，必要时先点亮粉丝牌，并在每轮后核对计数增长；若任务不增长便停止该队列，不把 HTTP 成功误记为完成。

## 1.4.0 房间表情（2026-09-27）

重新检查 [官方直播页组件代码](https://s1.hdslb.com/bfs/static/blive/blfe-live-room/static/js/9649.1063b9e512e83582c1bc.js) 与 [官方播放器代码](https://s1.hdslb.com/bfs/static/bilibili-live-player/room-player.01626800.prod.min.js)：

- 组件通过 `GET /xlive/web-ucenter/v2/emoticon/GetEmoticons?platform=pc&room_id=真实房间号` 获取表情。登录 Edge 页面只读请求返回 `code: 0`，`data.data` 为表情包数组，包内 `emoticons` 包含 `emoji`、`url`、`perm`、`emoticon_unique` 等字段。未登录请求返回 `-101`。
- `emoticonDanmakuPermCheck` 仅在 `perm === 1` 时直接允许发送；其他状态会弹出解锁条件。脚本禁用未授权表情，开始任务前重新读取列表。
- 表情包 `pkg_type === 3` 在组件中调用 `addEmoticons`，把 `descript` 加入草稿；其他包调用 `sendEmoticons`。脚本仅支持独立表情弹幕，排除类型 3。
- `sendEmoticons` 使用 `msg: emoticon_unique`、`dm_type: 1`，以及 bubble/color/mode 等常规字段，播放器将它们发送到 WBI 签名的 `/msg/send`。内置表情方法没有类似数字发送的成功回调，并在内部捕获请求错误；返回的 Promise 不能确认成功。因此脚本直接提交相同的核心协议字段，等待 HTTP/业务回执，不修改草稿。

1.4.0 按真实房间号保存用户选择，避免房间专属表情跨房间混用。登录页面只验证了表情读取，没有进行真实表情发送或到账验证；发送协议、失败停止、30 次点赞分组及跨房间任务增长由本地响应测试验证。跨房间实际运行仍要求任务计数增长才继续。

## 1.4.1 界面与分类过滤

按用户要求精简常驻文字，将上报确认、限速和接口检测移入默认折叠的运行详情。表情列表按 `pkg_name` 白名单保留 `UP主大表情`、`房间专属表情`（兼容 `房间专属`），忽略名称中的空白和 UP 大小写；仍排除插入草稿的类型 3。未根据未经核实的数字类型推断分类，也不在目标分类为空时展示通用或活动包。分类过滤同样用于开始任务前的表情权限复核。

## 1.5.0 随机内容与列表折叠

两个内容模式改为随机数字和随机表情。每次发送前独立抽取 1–10 整数，或从目标房间已解锁的指定类别表情中独立抽取一项；允许重复。配置改为按房间保存模式，随机表情在房间任务开始前自动读取可用池，不需要手动读取或选定单个表情。空可用池停止任务，发送确认、频率、30 赞分组和服务端任务核对逻辑保持原有行为。

粉丝牌房间列表放入原生 `details`，读取成功时默认展开，进度更新仅改内容而不改展开状态。本地测试使用受控随机值覆盖数字端点、重复抽样、表情权限过滤、跨房间随机池隔离及运行中折叠；浏览器测试通过真实点击验证展开/折叠状态在任务更新后保持。
