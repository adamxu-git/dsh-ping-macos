# Changelog

## 0.2.0 — 2026-10-29

- Renamed the package, loader id, bundle, locale namespace and sound route to
  `dsh-ping-macos` (the npm name `dsh-ping` belongs to another plugin).
- Settings and notification copy now default to Chinese, with an explicit
  `中文 / English` selector stored as `lang` in the plugin config. The host UI
  language no longer decides the plugin copy.
- Settings page: language row; the rest is unchanged.

## 0.1.0 — 2026-10-29

First working version.

- macOS system notification when a turn finishes or a pending interaction
  (approval / plan review / question) appears.
- Click raises the DSH window and opens the alerted conversation
  (`sessions.open` / `uiWorkspace.openSession`).
- Standard macOS Glass alert through a gated host route (`afplay`), with a
  sound toggle. Notification itself is silent to avoid a double chime.
- Settings section “Notifications”: master switch, reply-finished policy
  (away / always / off), needs-input policy (away / always / off), sound,
  test buttons.
- Defaults: reply finished “away”, needs input “always”; pending interactions
  that appeared while watching are queued and flushed when the page hides.
- Bounded runtime: one subscription per store, retry timer stops once bound,
  per-snapshot completion summary, at most 20 live notification handles,
  everything unsubscribed and closed on plugin dispose.
- zh/en copy follows the DSH locale.
- Mount via `dsh.bundle.patch` and `dsh.profile.bundles` (a raw
  `cordis.patch.yml` insert is removed when the app rewrites the patch layer).
- `node --test` suite for policies, quieted flush, sound, cap, dispose,
  click-to-session, settings registration, and the host route gate.

### Fixes during bring-up

- Access `slots` / `locale` through `ctx.get()`: direct property reads on a
  Cordis client context throw unless the service is in the plugin's `inject`
  list, which failed the whole boot entry.
- Allow `Origin: dsh-app://app` on the sound route so the desktop page can
  reach it.
