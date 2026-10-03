# dsh-cost-meter

DeepSeek Harness（DSH）Web 界面的**实时会话费用插件**：在输入框下方的统计栏旁显示当前会话的实时花费，并把「价格」「高峰时段」全部外置到一个配置文件里，方便随时改价、改时段。

```
本次费用5.16元（高峰费率×2）
```

悬停查看明细：

```
人民币计价 · 输入 12.4K · 缓存命中 3.2K · 输出 1.1K · 费用构成: 未命中输入 3.00元 · 命中输入 0.06元 · 输出 2.10元 · （高峰费率×2）
```

## 目录

- [特性](#特性)
- [安装](#安装)
- [配置文件](#配置文件)
- [默认计费模型](#默认计费模型)
- [配置如何生效](#配置如何生效)
- [已知限制](#已知限制)
- [故障排查](#故障排查)
- [开发参考](#开发参考)

## 特性

- **价格可配置**：费率表、高峰/非高峰倍率、高峰时段窗口、法定节假日全部在 [`config/pricing.json`](config/pricing.json) 里，代码中不再有任何价格常量。
- **实时**：直接订阅会话的 `tokenUsage` 投影（`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `outputTokens`），流式输出与每条助手消息都会即时刷新。
- **按模型计价**：读取当前会话的模型选择（`modelDirectories` 服务），切换模型立即按新费率重新计价；先精确匹配模型 ID，再按最长前缀匹配（`deepseek-flash-2026-x` 会落到 `deepseek-flash`）。
- **峰谷计价**：按 DeepSeek 官方规则——**北京时间**周一至周五 09:00–12:00、14:00–18:00 为高峰（费率 ×2），周末与法定节假日全天非高峰。
- **可换算货币**：默认直接显示人民币；把 `display.currency.enabled` 改成 `true` 即可换算成日元、美元等其他货币，支持实时汇率或固定汇率，实时汇率取不到时自动回退到固定汇率，详见[货币换算](#货币换算)。
- **双语**：随界面语言自动切换中英文；高峰倍率也会出现在文案里（配置成 ×3 就显示 ×3）。

## 安装

1. 插件文件夹移动到 `.dsh\profiles\web\packages\` 文件夹下（没有则创建），链接进 `profile` 的 `node_modules`

以下是PowerShell方式：
```pwsh
$base = Join-Path $env:USERPROFILE ".dsh\profiles"
New-Item -ItemType Junction `
  -Path   "$base\node_modules\dsh-cost-meter"
  -Target "$base\web\packages\dsh-cost-meter"
```

以下是macOS/Linux方式：`ln -s <目标> <链接>`
```sh
base="$HOME/.dsh/profiles"
ln -s "$base/web/packages/dsh-cost-meter" "$base/node_modules/dsh-cost-meter"
```

2. 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组里插入条目
```yaml
- insert:
  - id: cost-meter
    name: 'dsh-cost-meter'
```

3. 启动 web 服务
```
dsh web
```

之后：

- 改 `lib/client.js`：页面通过 dsh-client-hmr **免刷新热更新**。
- 改 `config/pricing.json`：无需重启、无需改代码，最长 5 分钟内自动生效（刷新页面立即生效）。
- 改 `package.json`：需要重启。

安装后自检：浏览器控制台应出现 `[dsh-cost-meter] composer.dock slot declared; registering entry id=cost`，`document.documentElement.dataset.dshCostMeter` 为 `registered`；host 端日志会出现 `[dsh-cost-meter] serving …\config\pricing.json at /dsh-cost-meter/pricing.json`。

## 配置文件

唯一的价格来源是 [`config/pricing.json`](config/pricing.json)。字段全部可选，缺项或写错的那一项会退回内置兜底值，不会让整条费用行消失。

```jsonc
{
  "version": 1,
  "updatedAt": "2026-10-04",                       // 建议每次改价顺手更新
  "source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",

  "billing": {
    "offPeakMultiplier": 1,                        // 非高峰倍率（pricing 表里填的就是这个价位）
    "peakMultiplier": 2,                           // 高峰倍率，官方规则是 2
    "peakZone": "Asia/Shanghai",                   // 说明字段：窗口按北京时间解释
    "peakWindows": [                               // 高峰时段窗口；days: 0=周日 … 6=周六
      { "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "12:00" },
      { "days": [1, 2, 3, 4, 5], "start": "14:00", "end": "18:00" }
    ],
    "holidays": []                                 // 中国法定节假日（YYYY-MM-DD），全天非高峰
  },

  "defaultModel": "deepseek-flash",                // 模型目录尚未上报时用的费率

  "pricing": {                                     // 元 / 百万 tokens，填非高峰价
    "deepseek-flash":                 { "cacheHit": 0.02, "cacheMiss": 1,   "output": 4 },
    "deepseek-v4-pro":                { "cacheHit": 0.15, "cacheMiss": 4.5, "output": 13.5 }
  },

  "display": {
    "currency": {
      "enabled": false,                           // 货币换算总开关，默认 false：直接显示人民币
      "code": "JPY",                              // 换算目标货币代码；仅 enabled 为 true 时生效，用法见下方「货币换算」
      "symbol": "円",                              // 行内与明细里显示的后缀
      "source": "feed",                           // "feed" = 实时汇率；"fixed" = 用 fixedRate
      "fixedRate": 21,                            // 「1 元 = N 目标货币」；fixed 时直接用，feed 取不到汇率时回退到它
      "feed": {
        "url": "https://open.er-api.com/v6/latest/CNY",   // 汇率接口，需返回以人民币为基准的汇率
        "ratePath": "rates.JPY",                  // 从响应体里取汇率的点号路径，要与 code 对应
        "refreshMs": 60000                        // 汇率刷新间隔（毫秒）
      }
    }
  }
}
```

常用改法：

| 想做的事 | 改哪里 |
| --- | --- |
| 官方调价 | 改 `pricing.<model>` 三个单价 |
| 回退到整段非高峰 | `billing.peakMultiplier` 改成 `1` |
| 换高峰窗口（比如官方改时段） | 改 `billing.peakWindows` 的 `days`/`start`/`end` |
| 补法定节假日 | 往 `billing.holidays` 加 `"2026-10-01"` 这样的日期 |
| 新增模型 | 往 `pricing` 加一条，键名用模型 ID 或其前缀 |
| 某个模型没有峰谷价 | 在该模型下同时写 `"peakMultiplier": 1, "offPeakMultiplier": 1` |

> `peakZone` 目前是**说明性字段**：窗口时刻一律按北京时间（UTC+8，无夏令时）折算。窗口可以跨零点（例如 `days: [5], start: "23:00", end: "01:00"`），此时单日窗口自动覆盖到次日。

### 货币换算

默认**不换算**：费用直接按人民币（元）显示，也不会联网取汇率。想换成其他货币，把 `display.currency.enabled` 改成 `true`，再按需调整下面这些字段：

| 字段 | 说明 |
| --- | --- |
| `enabled` | 换算总开关。`false`（默认）= 显示人民币；`true` = 按下面的设置换算。 |
| `code` | 目标货币代码，如 `JPY`、`USD`。 |
| `symbol` | 行内与明细里显示的后缀，如 `円`、`$`。 |
| `source` | `"feed"` = 实时汇率；`"fixed"` = 用 `fixedRate`。 |
| `fixedRate` | 「1 元 = N 目标货币」。`source` 为 `"fixed"` 时直接使用；为 `"feed"` 时作为取不到实时汇率的回退值。 |
| `feed.url` | 汇率接口地址，默认 `https://open.er-api.com/v6/latest/CNY`。 |
| `feed.ratePath` | 从响应体里取汇率的点号路径，如 `rates.JPY`；换币种时要和 `code` 保持一致。 |
| `feed.refreshMs` | 汇率刷新间隔（毫秒）。 |

示例：

```jsonc
// 实时日元
"currency": { "enabled": true, "code": "JPY", "symbol": "円", "source": "feed",
              "feed": { "url": "https://open.er-api.com/v6/latest/CNY", "ratePath": "rates.JPY", "refreshMs": 60000 } }

// 固定美元汇率（不联网）
"currency": { "enabled": true, "code": "USD", "symbol": "$", "source": "fixed", "fixedRate": 0.14 }
```

换算公式为 `费用(目标货币) = 费用(元) × 汇率`。实时汇率（`source` 为 `"feed"`）取不到时，自动回退到 `fixedRate`，所以建议把 `fixedRate` 设成一个接近当前的汇率。汇率仅用于展示，真实扣费以 DeepSeek 的人民币账单为准。

## 默认计费模型

数据来源：[DeepSeek API 官方「模型 & 价格」](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（核对日期 2026-10-04）。单位：**人民币元 / 百万 tokens**。

| 模型 | 缓存命中（非高峰 / 高峰） | 缓存未命中（非高峰 / 高峰） | 输出（非高峰 / 高峰） |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

- 旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍可调用，官方由 DeepSeek-V4.1-Flash 提供服务并按 Flash 价格计费，因此配置里把它们映射到 Flash 价位。
- 高峰时段（北京时间周一至周五 09:00–12:00、14:00–18:00，不含法定节假日）按高峰价，其余时间（含周末与节假日全天）按非高峰价。

### 旧模型（V3.2-Exp 时代的 flat 价，无峰谷）

`deepseek-chat`、`deepseek-reasoner` 是 DeepSeek-V3.2-Exp 时代的名字（分别是非思考 / 思考模式），**现行价目表已不再列出**。它们在配置里的单价取自 **2025-09-29 的官方定价页存档快照**（[中文快照](https://web.archive.org/web/20250929102137/https://api-docs.deepseek.com/zh-cn/quick_start/pricing)）：

| 模型 | 版本 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- | --- |
| `deepseek-chat` | DeepSeek-V3.2-Exp（非思考模式） | 0.2 元 | 2 元 | 3 元 |
| `deepseek-reasoner` | DeepSeek-V3.2-Exp（思考模式） | 0.2 元 | 2 元 | 3 元 |

### 按模型覆盖峰谷倍率

`pricing` 里每条模型除了 `cacheHit` / `cacheMiss` / `output`，还可以写 `peakMultiplier` 与 `offPeakMultiplier` 覆盖全局 `billing` 规则。规则是**要么都写、要么都不写**（只写一个会被忽略，避免出现无法解释的倍率组合）：

```jsonc
"deepseek-chat": {
  "cacheHit": 0.2, "cacheMiss": 2, "output": 3,
  "peakMultiplier": 1, "offPeakMultiplier": 1   // 该模型没有峰谷价：恒按原价
}
```

计费公式（`mult` 为当前时段的倍率，取自 `billing`）：

```
费用(元) = ( cacheReadTokens × cacheHit
           + (uncachedInputTokens + cacheWriteTokens) × cacheMiss
           + outputTokens × output
         ) × mult / 1e6
```

## 配置如何生效

```
config/pricing.json ──(host 读文件、按 mtime/size 缓存)──► GET /dsh-cost-meter/pricing.json
                                                              │
                                                              │
                                                              │
                                          client fetch（页面加载 + 每 5 分钟）
                                                              │
                                                              │
                                                              ▼
                                     归一化合并到内置兜底 ──► 费用行按新价重算
```

- **host 端**：`lib/index.js` 通过 `ctx.webServer.register` 注册精确路由 `/dsh-cost-meter/pricing.json`；每次请求都 `stat` 一次文件，只有 `size:mtimeMs` 变化才重新读取并解析，因此改文件立刻生效，且不会把磁盘读爆。仅允许 `GET`/`HEAD`，跨站 `Origin` 一律 403，响应 `Cache-Control: no-store`。
- **client 端**：浏览器用**文档相对** URL 请求（`dsh-cost-meter/pricing.json`），因此在带挂载前缀的反向代理下同样可用。取到的配置写入 `sessionStorage`（键 `dsh-cost-meter.pricing`），刷新页面时先用缓存里的上一份好配置，再取最新。
- **没有 host 路由时**（例如 Electron 的 `file://` 外壳，或组合里没有 `webServer` 服务）：插件照常工作，只是使用 `lib/client.js` 里的内置兜底费率，并在 host 日志里给出说明。

## 已知限制

- **整段会话按当前时段计价**：`tokenUsage` 投影是聚合值，客户端拿不到每个请求的时间戳，因此整段历史都按**渲染那一刻**的峰/谷倍率计价。进行中的会话绝大部分 token 属于当前轮次，实时数字与实际账单接近，但不是逐请求精确账单。
- **法定节假日需手工维护**：官方规则是「不含中国法定节假日」，但节假日安排每年由国务院办公厅公布，插件无法内置万年历。请在每年放假通知发布后更新 `billing.holidays`；不填时法定节假日会被算作高峰（费用偏高）。
- **未收录的模型不显示费用行**：费率表里既无精确匹配也无前缀匹配的模型，直接隐藏费用行，避免对未知模型猜价格。
- **子代理会话**：用量归属以 Harness 的投影为准，插件不另做拆分。
- **内置兜底费率需要手工同步**：`lib/client.js` 里的 `FALLBACK_PRICING` 是配置文件取不到时的兜底，改价时建议一并更新（不改也能工作，只是首屏或离线时价格偏旧）。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 费用行完全不出现 | 当前模型未收录进 `pricing`（含前缀匹配）。控制台执行 `await fetch('dsh-cost-meter/pricing.json').then(r=>r.json())` 查看实际生效的费率表。 |
| 改了 JSON 但价格没变 | 校验 `GET /dsh-cost-meter/pricing.json` 是否返回 200 与最新内容；host 端解析失败会返回 500（保留旧价），看 host 日志里的报错。 |
| 数字比预期高一倍 | 正处于高峰时段（北京时间工作日 09:00–12:00 / 14:00–18:00）。 |
| 数字比预期高一倍，且不是高峰 | 法定节假日未填进 `billing.holidays`。 |
| 想临时验证一倍价 | 把 `billing.peakMultiplier` 改成 `1` 即可（也可用来对照官方账单）。 |

## 开发参考

- 槽位：`conversation.composer.dock`（由 `dsh-client-ui-conversation` 声明，与官方统计行同一条带）。
- 数据：标准槽位属性 `useProjection("tokenUsage")`；当前模型来自 `ctx.get("modelDirectories")`（`dsh-client-ui-model-selection` 提供，声明为客户端注入项）。
- host 半部分：`ctx.effect(() => webServer.register({ kind: 'exact', path, handler }))`，disposer 随插件卸载自动注销路由。
- 配置解析：`lib/client.js` 内的 `normalizeConfig` 会逐字段校验并合并兜底值；数字必须是有限非负数、时间必须是 `HH:MM`、`days` 必须是 0–6，非法值逐项丢弃。
- 依赖只有 `react` 与 `react/jsx-runtime`（平台内置模块），无第三方运行时依赖。
- 样式以内联字符串注入 `<style data-plugin-css="dsh-cost-meter/CostDock.css">`，卸载时由 client-modules 清理。
- [`lib/pricing.js`](lib/pricing.js) 是给 `client.js` 内联那一段配置层留的**可读镜像，运行时不会加载**（client-modules 每个插件只 materialize 一个自包含模块，相对 `require` 会直接抛错）。改配置层逻辑时请同时改 `lib/client.js` 里对应的内联代码。

## 卸载

从 `cordis.patch.yml` 删除对应条目、删掉 `node_modules` 联接、重启 `dsh web`；浏览器侧无需清理（`sessionStorage` 的键可以顺手删掉）。
