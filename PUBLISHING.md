# Publishing `dsh-ping` as a downloadable DSH plugin

## 1. Name

`dsh-ping` is **already taken** on npm: `dsh-ping@1.9.0`, "play a sound and
show a desktop notification when the agent needs you" — the same problem space.

Available at the time of writing:

- `dsh-ping-macos` (unclaimed)
- a scope, e.g. `@yourname/dsh-ping`

Recommendation: `dsh-ping-macos`, or a scope if you want to own the namespace.
The folder can stay `dsh-ping/`; `package.json.name`, the patch's `name:`, and
the loader entry `id:` must all change together. Keep the id unique: installing
this alongside the existing `dsh-ping` must not collide.

## 2. Prior art

| Package | What it does | Notes |
|---|---|---|
| `dsh-ping@1.9.0` | sound + desktop notifications on stage/approval/input/complete/error | Windows-first, settings page, ~116 downloads/month |
| `dsh-notify-me` | notifications, approvals, external push (Bark/Feishu/Slack), host fallback | 75 stars, very complete |
| `dsh-notice-center` | tab status light + browser notifications + 45 sounds | |
| `dsh-task-feedback` | favicon state + synthesized sounds | |

This plugin's angle is **minimal and auditable**: ~400 lines, zero runtime
dependencies, zero network, no native code, macOS-native notification identity,
click-to-session, per-snapshot aggregation, bounded handles. It deliberately
has no settings page, no external push, no custom sounds.

That is a real but narrow differentiator. If the goal is adoption rather than a
personal tool, consider adding at least a settings page and a sound toggle, or
contributing macOS click-to-session to an existing plugin.

## 3. package.json for publishing

```json
{
  "name": "dsh-ping-macos",
  "version": "0.1.0",
  "description": "Minimal macOS notifications for DeepSeek Harness: reply finished / needs your input.",
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/",
    "cordis.patch.yml",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "keywords": [
    "dsh-plugin",
    "deepseek-harness",
    "macos",
    "notification"
  ],
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" },
    "compatibility": {
      "dshReleases": { "0.2.1-rc.2": "compatible" }
    }
  }
}
```

Remove `private: true`. Add `repository`, `homepage`, `bugs` once the GitHub
repo exists.

`dsh.bundle.patch` is what makes `dsh plugin add` (and the Desktop plugin
manager) reconcile `dsh.profile.bundles`; without it the package must be
inserted into `cordis.patch.yml` by hand.

## 4. Install paths to document

Desktop:

> 插件 → 添加插件 → 搜索 `dsh-ping-macos` → 安装 → 完全退出并重启。

Web:

```sh
dsh plugin --profile web add dsh-ping-macos
```

Custom profile: replace `web` with the profile name; restart that profile.

## 5. Repo checklist

- [ ] `LICENSE` (MIT, copyright line)
- [ ] `README.md` (zh) + `README.en.md`
- [ ] `CHANGELOG.md` (keep a Changelog format)
- [ ] `test/` — move the `node:vm` harness out of `/tmp`; `npm test` runs it
- [ ] GitHub Actions: `npm test`, `npm pack --dry-run`
- [ ] `dsh-plugin` topic on the repo
- [ ] Screenshot / short GIF of the notification (README + marketplace card)
- [ ] Privacy note: no network, no storage, no telemetry
- [ ] Compatibility matrix: 0.2.1-rc.2 verified on macOS Desktop; Web untested
- [ ] Known limitations: page must stay alive; no Dock/menu bar; desktop no
      approval buttons; multi-window duplicates

## 6. Marketplace

1. Publish to npm.
2. Add the entry to `awesome-dsh-plugin/awesome-dsh-plugin` (that repo takes
   PRs; it is the curated list the in-app market reads).
3. The in-app market indexes it, usually within a day.

## 7. Release flow

```sh
npm test
npm pack --dry-run
npm version patch
npm publish
git push --follow-tags
```

## 8. Open decisions

- Name: `dsh-ping-macos` vs scope?
- npm account / org.
- GitHub repo URL and license holder.
- Is adoption the goal, or a clean personal tool? That decides whether to add
  settings/sounds before publishing.
