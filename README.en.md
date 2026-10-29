# dsh-ping-macos

[![npm](https://img.shields.io/npm/v/dsh-ping-macos.svg)](https://www.npmjs.com/package/dsh-ping-macos)

Minimal macOS notifications for DeepSeek Harness: a system banner + the
standard macOS alert (Glass) when a reply finishes or the agent needs you.
Clicking the notification raises the window and opens that conversation.

No Dock badge, no menu-bar item, no network requests. One client plugin plus a
tiny host half that only runs `afplay`.

## Behavior

| Event | When | Notification |
|---|---|---|
| Reply finished | `sessions.list` row `running: true → false` | “Reply finished · title”, banner |
| Needs your input | new `pendingInteraction` in `uiSession.sessionStatus` | “Needs your input · approval/plan/question”, sticky |
| Subagent sessions | `origin: 'subagent'` or `parentId` | muted |
| Burst of completions | several `running → false` in one snapshot | one “N conversations finished” summary |

Policies are configurable in **Settings → Notifications**: master switch,
reply-finished policy (away / always / off, default away), needs-input policy
(away / always / off, default always), and sound.

Clicking a notification calls `dsh://open` and then `sessions.open(id)` or
`uiWorkspace.openSession(id)` to switch conversations.

## Install

**Desktop**: Plugins → **Add plugin** → search `dsh-ping-macos` → install →
fully quit (Cmd+Q) and reopen.

**Web**:

```sh
dsh plugin --profile web add dsh-ping-macos
```

Restart that `dsh web` and hard-refresh the page.

<details>
<summary>From source (development)</summary>

```sh
git clone https://github.com/adamxu-git/dsh-ping-macos.git \
  ~/.dsh/profiles/desktop/node_modules/dsh-ping-macos
```

Then add `"dsh-ping-macos"` to `dsh.profile.bundles` in
`~/.dsh/profiles/desktop/package.json`, fully quit DSH, and reopen.

</details>

## Settings

Settings → Notifications. The page is contributed through `settings.section`;
the core reminder works even when `slots`/`locale` are unavailable.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | true | master switch |
| `done` | `away` | when a finished turn notifies |
| `attention` | `always` | when an approval/question notifies |
| `sound` | true | play `Glass.aiff` through the host |

Stored in `localStorage` under `dshPing.config.v1`; no network.

## Structure

- `lib/client.js` — detection, policy, notifications, settings page
- `lib/index.js` — `POST /__dsh-ping-macos/sound`, gated to loopback + marker header
- `cordis.patch.yml` — bundle patch that mounts the plugin
- `test/` — `node --test` suite with fake services

## Limits

- The page (window hidden is fine) must be alive; quitting the app stops alerts.
- No Dock badge: `app.dock.setBadge` is main-process-only and the shell exposes
  no bridge. This plugin only does notifications.
- No approval buttons on desktop (`dsh-app://` cannot register a Service Worker).
- Notification copy follows the UI locale (zh/en); the sound is macOS-only.
- Multiple DSH windows each run their own copy and can alert twice.

## Privacy

No network calls, no telemetry, no eval. One `localStorage` record for settings.

## License

MIT
