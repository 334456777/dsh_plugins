# dsh-notifier

DeepSeek Harness（DSH）Web 界面的**浏览器通知插件**

- **对话完成**：当前会话从「运行中」变为空闲时，弹一条系统通知（标题「对话完成」，正文为会话标题）。
- **待确认命令**：命令需要批准时，弹一条「需要确认命令」通知（正文为工具名 + 原因首行），且在 Chromium 内核浏览器上**通知自带「允许 / 拒绝」按钮**，不必切回页面。

## 目录

- [安装](#安装)
- [使用](#使用)
- [浏览器能力矩阵](#浏览器能力矩阵)
- [触发条件](#触发条件)
- [重复提醒](#重复提醒)
- [技术实现](#技术实现)
- [已知限制](#已知限制)
- [安装](#安装)
- [卸载](#卸载)

## 安装

1. 插件文件夹移动到 `.dsh\profiles\web\packages\` 文件夹下（没有则创建），链接进 `profile` 的 `node_modules`

以下是PowerShell方式：
```pwsh
$base = Join-Path $env:USERPROFILE ".dsh\profiles"
New-Item -ItemType Junction `
  -Path   "$base\node_modules\dsh-notifier"
  -Target "$base\web\packages\dsh-notifier"
```

以下是macOS/Linux方式：`ln -s <目标> <链接>`
```sh
base="$HOME/.dsh/profiles"
ln -s "$base/web/packages/dsh-notifier" "$base/node_modules/dsh-notifier"
```

2. 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组里插入条目
```yaml
- insert:
  - id: notifier
    name: 'dsh-notifier'
```

3. 启动 web 服务
```
dsh web
```

## 使用

选择模型按钮左边会多一个 **`通知 · 开/关`** 小按钮：

1. 点击 → 浏览器弹出通知权限请求 → 允许（Safari 会在「网站设置」里记住 `127.0.0.1`）。
2. 开启瞬间会立刻发一条「通知已开启」的测试通知，用来确认链路通畅。
3. 再点一次即可随时关闭；关闭时所有正在进行的重复提醒立即停止。

开关状态存在 `localStorage` 的 `dsh-notifier.enabled`（`"1"` / `"0"`）；权限被拒绝时按钮置灰，悬停提示去浏览器站点设置里放行。

## 浏览器能力矩阵

| 浏览器 | 通知样式 | 说明 |
| --- | --- | --- |
| Chrome / Edge 等 Chromium 内核 | 带 **允许 / 拒绝** 按钮 | 通过 Service Worker 的 `notificationclick` 把决定回传给页面，直接应答审批 |
| Safari（桌面） | 纯文本通知 | **Safari 至今不实现通知 `actions`**；点击通知会聚焦 DSH 页面，页面上已有审批对话框，点一下即可 |

> 这是 Web Notification API 的硬限制，不是插件取舍。Safari 上的最优路径就是「点通知 → 聚焦页面 → 页面里点允许」。

## 触发条件

两类通知都由**当前会话**的 ConversationSnapshot 驱动：

| 通知 | 触发条件 | 正文 |
| --- | --- | --- |
| 待确认命令 | `useSession(s => s.pending)` 中出现 `kind === "approval"` 的新条目 | 工具名 + 原因首行（截断到 180 字符） |
| 对话完成 | `useSession(s => s.running)` 由 `true` 变 `false`，且此刻没有待确认条目 | 会话标题（取不到时用「会话已完成」） |

细节：

- **只跟踪当前会话**：每个 sessionId 的运行状态单独记忆（`runningRefs`），来回切换会话不会误报完成。
- **完成通知会等审批**：若从运行中变空闲时仍挂着待确认命令，则不发「对话完成」，避免和审批通知互相盖掉。
- **窗口已聚焦时不弹**：`document.visibilityState === "visible"` 且 `document.hasFocus()` 时认为你正在看，普通通知直接跳过（测试通知例外）。
- **只通知 `approval` 类交互**：`question`（代理提问）不通知。

## 重复提醒

通知发出后如果窗口仍未获得焦点，插件会**持续重复提醒**，避免错过审批：

- 首次提醒在 60 秒后；
- 之后每次比上一次提前 5 秒，最快 5 秒一次；
- 每次都用同一个 `tag` 重新发送，因此操作系统通知中心里始终是**同一条**在反复响铃/弹横幅，而不是刷屏；
- 窗口重新获得焦点（`focus` / `visibilitychange`）时，所有重复提醒立即停止；关闭开关同样全部停止。

## 技术实现

```
ConversationSnapshot ──► NotifierControl（会话快照座位）
        │                         │
        │                         │
        │                 fireNotification(title, options)
        │                         │
        │                         │
        │                         ▼
        │            Chromium：navigator.serviceWorker.register(...).showNotification(...)
        │            Safari / 注册失败：new Notification(title, options)
        ▼
通知按钮点击 ──► SW notificationclick ──► clients.matchAll 找页面 ──► postMessage
                                                                        │
                                                                        │
                                                                        │
页面 window "message" 监听 ◄────────────────────────────────────────────┘
        │  
        │ 按 key 找到 PendingWait 载体
        │
        ▼
wait.respond({ ok: true, value: { sessionId, approvalId, outcome } })
```

- **数据来源**：全部来自会话快照标准座位——`useSession(s => s.pending)`（审批载体数组，各自带 `respond` 应答方法）与 `useSession(s => s.running)`（完成信号），`useSessions` 取会话标题。host 端不需要参与。
- **双用途 bundle**：同一个 `lib/client.js` 在 ServiceWorker 全局作用域里只安装 `notificationclick` 桥；在页面里正常注册 UI。这样不必额外维护一个 SW 文件。
- **审批应答**：通知按钮点击 → SW 找到非 `/plugins/` 前缀的窗口（即 DSH 页面）→ `postMessage({ source: "dsh-notifier", action: "approval-answer", key, outcome })` → 页面按 `key` 找到 `PendingWait` 并 `respond`。
- **重复提醒的定时器**：以通知 `tag` 为键集中管理（`reminders`），同一 `tag` 只保留一个循环。
- **locale**：文案注册在命名空间 `notifier` 下，随界面语言切换中英文。
- **槽位**：`conversation.input.right`（输入框右侧工具行），条目 id `notifier`，`order: 50`。

## 已知限制

- **Safari 没有通知按钮**（见上表），只能点通知回到页面再审批。
- **页面关闭后按钮点击无效**：审批载体活在页面里，页面不在时通知按钮的决定无处投递，审批保持挂起，直到回到页面。
- **只通知审批类交互**，代理提问（`question`）不通知。
- **子代理会话不通知**：只跟踪当前顶层会话。
- **多开标签页可能重复通知**：每个标签页都会侦测到同一状态变化；操作系统按 `tag` 去重合并，但仍可能出现多余的一次提醒。
- **Service Worker 注册用的是绝对路径** `/plugins/dsh-notifier/client.js`：把 DSH 挂在子路径下部署时按钮会失效（通知本体仍走页面通道）。如需支持挂载前缀，可改为按 `import.meta.url` 推导。
- **通知权限是浏览器级设置**：关闭插件开关不会撤销已授予的权限，需要用浏览器的站点设置清除。

## 安装

与 `dsh-cost-meter` 相同的三步（包体链接 → `cordis.patch.yml` 插入条目 → 重启 `dsh web`），详见 [上级 README](../README.md#安装到-web-profile)。该插件的 host 半部分是空实现，安装后无需任何 host 配置：

```yaml
- insert:
    - id: notifier
      name: 'dsh-notifier'
```

重启后自检：输入框右侧出现 `通知 · 开` 按钮；点击能弹出权限请求并能收到测试通知。之后改 `lib/client.js` 走 dsh-client-hmr 免刷新热更新。

## 卸载

从 `cordis.patch.yml` 删除对应条目、删掉 `node_modules` 联接、重启 `dsh web`；然后在浏览器里清除对 `127.0.0.1` 的通知授权，并删除 `localStorage` 键 `dsh-notifier.enabled`。
