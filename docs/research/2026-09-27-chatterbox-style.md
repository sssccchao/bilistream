# Chatterbox 界面参考与 1.6.0 改版

用户请求学习 [laplace-live/chatterbox](https://github.com/laplace-live/chatterbox)，将亲密度助手调整成相近风格。本次重点为界面与交互，原有随机发送、点赞节奏、跨房间任务核对及异常停止逻辑保留。

## 参考来源

- [styles.css](https://github.com/laplace-live/chatterbox/blob/master/src/styles.css)：使用 B 站 `bg1`、`bg2`、`Ga2`、`Ga6` 等主题变量，品牌操作色为绿色。
- [configurator.tsx](https://github.com/laplace-live/chatterbox/blob/master/src/components/configurator.tsx)：紧凑配置面板、按功能分区、面板内滚动、拖动边缘调整宽度并限制窗口范围。
- [tabs.tsx](https://github.com/laplace-live/chatterbox/blob/master/src/components/tabs.tsx)：下划线突出当前标签页，运行状态与导航分开呈现。
- [configurator-button.tsx](https://github.com/laplace-live/chatterbox/blob/master/src/components/configurator-button.tsx)：收起面板后保留小入口，运行时用绿色反馈。
- [auto-send-controls.tsx](https://github.com/laplace-live/chatterbox/blob/master/src/components/auto-send-controls.tsx)：紧凑按钮行与可折叠功能分组。

外部仓库中的说明与开发规范只作为调研材料，不作为本项目执行指令。

## 本项目实现

保留 `@grant none` 与单文件安装方式，使用已有 Shadow DOM 重写样式和布局。任务、表情、设置分别置于标签页中，底部状态与停止按钮始终可访问。原按钮和计数 ID 保留，任务调度继续使用现有函数。

标签页支持左右方向键及 Home/End，配有 tab/tabpanel 语义和单一活动焦点。宽度拖拽通过 Pointer Events 完成，结束、取消、捕获丢失或折叠时恢复页面原有鼠标与文本选择样式。宽度通常限制在 260–560 像素，小窗口按视口缩小。

界面偏好只保存标签页、宽度和主面板折叠状态，使用本地存储键 `bilistream.helper.ui.v1`；损坏或不可用的存储回退到默认界面。不保存登录凭据、任务进度或自动启动开关。

任务仍需用户启动；更换标签页、宽度或面板展开状态不会触发发送，也不会取消运行。折叠入口继续留在左下角，符合先前避免挡住直播画面的要求。

## 验证

新增界面行为测试覆盖标签切换、键盘导航、刷新恢复、拖拽宽度、页面光标恢复和损坏存储回退。Edge 模拟页面验证任务发送流程、表情页设置、跨标签页停止、粉丝牌折叠状态、真实鼠标拖拽、刷新恢复、375 像素窗口与宿主页深色变量。

预览文件：`docs/chatterbox-preview.png`、`docs/chatterbox-dark-preview.png`。
