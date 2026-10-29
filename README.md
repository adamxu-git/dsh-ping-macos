# dsh-ping-macos

[English](README.en.md) | 中文

最小可用的 macOS 通知插件：DeepSeek Harness 里**回复跑完**或**需要你介入**时，右上角弹一条系统通知 + macOS 标准提示音（Glass），点通知回到窗口并切到该会话。

没有 Dock 角标、没有菜单栏图标、没有网络请求。一个 client 插件 + 一个只负责 `afplay` 的极小的宿主半。

## 行为

| 事件 | 触发条件 | 通知 |
|---|---|---|
| 回复完成 | `sessions.list` 里某会话 `running: true → false` | 「回复完成 · 会话名」，普通横幅 |
| 需要你确认 | `uiSession.sessionStatus` 里出现新的 `pendingInteraction` | 「需要你确认 · 审批/方案/提问」，常驻提醒 |
| 子代理会话 | `origin: 'subagent'` 或带 `parentId` | 默认静音 |
| 你正看着窗口 | 取决于设置：`回复完成` 默认不弹，`需要你确认` 默认弹 | 在「设置 → 通知提醒」里改 |
| 设置 | 通知开关 / 完成策略 / 待处理策略 / 提示音 | 存在本机 `localStorage`，不联网 |
| 同一快照多个完成 | 一次列表更新里多个 `running → false` | 合并成一条「N 个会话完成」 |

点通知 → 通过隐藏 iframe 导航 `dsh://open` 抬起窗口（`window.focus()` 抬不动 Electron 窗口），并调用 `sessions.open(id)`（0.1.5）或 `uiWorkspace.openSession(id)`（0.1.6+）切到对应会话；两者都没有时只抬窗。

## 文件

- `lib/client.js` — 全部逻辑（浏览器半）
- `lib/index.js` — 宿主半：注册 `POST /__dsh-ping-macos/sound`，用 `afplay` 播放 macOS 的 Glass 提示音
- `package.json` — `dsh.client.platform: web`
- `cordis.patch.yml` — 打包用（作为 bundle 安装时）

## 安装

> npm 包名 `dsh-ping-macos`（`dsh-ping` 已被另一个同赛道插件占用）。发布前先从源码安装。

**Desktop**

```sh
git clone https://github.com/adamxu-git/dsh-ping-macos.git ~/.dsh/profiles/desktop/node_modules/dsh-ping-macos
```

然后在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里加一行 `"dsh-ping-macos"`，**Cmd+Q 完全退出**再打开。

**Web**

```sh
dsh plugin --profile web add file:/path/to/dsh-ping-macos
```

装完重启对应的 `dsh web`，硬刷新页面。

> 不要手动往 `cordis.patch.yml` 里插 `insert` 行：DSH 改写 patch 层时会把不认识的行清掉。这个包用 `dsh.bundle.patch` + `dsh.profile.bundles` 挂载。

## 验证

重启后不会再弹欢迎通知。验证方式：

- 把窗口切到别的应用，让 agent 跑一个任务，结束时应该弹「回复完成」。
- DevTools 控制台：

```js
__dshPing.state()            // 绑定状态、permission、记账条数、通知句柄数、定时器状态
__dshPing.test('done')       // 立即弹一条完成通知
__dshPing.test('attention')  // 立即弹一条待处理通知
```

点通知应该抬起窗口并切到对应会话。

设置页在 **设置 → 通知提醒**：总开关、回复完成策略（仅离开/总是/关闭）、需要你确认策略、提示音开关，以及两个测试按钮。默认：完成「仅离开」，待处理「总是」。

`permission` 不是 `granted` 时，去「系统设置 → 通知 → DeepSeek Harness」允许。

## 卸载 / 回到安装前

```sh
cp ~/.dsh/profiles/desktop/cordis.patch.yml.bak-20261029-203052 \
   ~/.dsh/profiles/desktop/cordis.patch.yml
rm -rf ~/.dsh/profiles/desktop/node_modules/dsh-ping-macos
```

然后重启 DSH Desktop。

## 健壮性

- 每个 store 只订阅一次；插件被卸载时退订、清定时器、关掉自己开着的通知。
- 绑定成功后重试定时器立即停止，不留常驻轮询。
- 已完成会话/待处理会话的记账按会话 id，会话消失即清理；通知句柄上限 20 条。
- 合并通知在列表回调里同步完成，不用 `setTimeout`（隐藏窗口的定时器会被 Chromium 节流）。
- 所有回调都有 try/catch；空快照、坏行、通知权限被拒都不会抛。
- 无网络请求、无 `eval`；只写一个 `localStorage` 配置项；`visibilitychange` / `blur` 监听在卸载时移除。
- 压力测试：3000 个会话同时完成 → 1 条汇总、约 0.6 ms；50 轮 × 200 会话增删后内部记账仍只有 200 条。

## 已知限制

- 只有页面（窗口隐藏也算）还活着时才能提醒；退出 App 就没了。
- 没有 Dock 红点/菜单栏红点：Dock 角标只能由 Electron 主进程设置，插件够不到；这一版只做右上角通知。
- 提示音依赖 macOS 的 `afplay` 和 `/System/Library/Sounds/Glass.aiff`；非 macOS 或宿主没有 webServer 时静默，通知照常。
- 桌面端没有审批按钮（Service Worker 在 `dsh-app://` 下不可用）。
- 按会话去重靠 `tag`；同一会话连续两次完成会各弹一条。
- 一次快照里多个会话完成会合并成一条，这种汇总通知点击只抬窗，不切会话（没有唯一目标）。
- 依赖 `sessions.list` / `uiSession.sessionStatus` 的 0.2.x 快照形状；宿主改形状要跟着改。
- 开多个 DSH 页面/窗口时，每个页面各跑一份，会各自提醒；设置也存在各自的 localStorage。
