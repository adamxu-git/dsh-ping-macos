// dsh-ping — browser half.
//
// Loaded by dsh-client-modules at /plugins/dsh-ping/client.js and evaluated by
// the shell's lazy-CJS module loader: executing this file only registers the
// factory; the body below runs at materialization.
//
// What it does:
//   - watches `sessions.list` for a turn's running edge (true -> false) and
//     `uiSession.sessionStatus` for a new pendingInteraction (approval /
//     plan-review / question);
//   - raises a macOS notification through the page's Notification API, so it
//     appears with the signed DeepSeek Harness identity;
//   - clicking the notification raises the window and opens that conversation;
//   - plays the macOS standard alert sound through a tiny host route;
//   - contributes a small Settings section (enable, done/attention policy,
//     sound, test buttons).
//
// Bounded by design: one subscription per store, one retry timer that stops
// once both stores are bound, per-snapshot coalescing for finished turns, at
// most MAX_LIVE notification handles, and one small localStorage record.
(function (root) {
  if (!root || !root.__ModuleLoader__ || typeof root.__ModuleLoader__.load !== 'function') return;

  root.__ModuleLoader__.load({
    id: 'dsh-ping',
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

      var React = null;
      try {
        React = require('react') || null;
      } catch (e) {
        React = null;
      }

      var NS = 'dsh-ping';
      var CONFIG_KEY = 'dshPing.config.v1';
      var MAX_LIVE = 20;
      var DEFAULTS = { enabled: true, done: 'away', attention: 'always', sound: true };

      var UI = {
        zh: {
          nav: '通知提醒',
          enabled: '启用通知提醒',
          done: '回复完成',
          attention: '需要你确认',
          away: '仅离开时',
          always: '总是',
          off: '关闭',
          sound: '提示音',
          soundHint: '使用 macOS 标准提示音（Glass）',
          testDone: '测试「回复完成」',
          testAttention: '测试「需要你确认」',
          note: '设置保存在本机，不联网。',
          doneTitle: '回复完成',
          askTitle: '需要你确认',
          doneBody: '「%s」这一轮跑完了',
          batchTitle: '%d 个会话完成',
          batchBody: '%s 已跑完',
          askBody: '「%s」· %s',
          q: '有一个问题等你回答',
          plan: '有一个方案等你确认',
          approval: '有一个审批请求等你处理',
          testDoneBody: '测试 · 这一轮跑完了',
          testAttentionBody: '测试 · 审批请求等你处理',
        },
        en: {
          nav: 'Notifications',
          enabled: 'Enable notifications',
          done: 'Reply finished',
          attention: 'Needs your input',
          away: 'Only when away',
          always: 'Always',
          off: 'Off',
          sound: 'Sound',
          soundHint: 'macOS standard alert (Glass)',
          testDone: 'Test “reply finished”',
          testAttention: 'Test “needs your input”',
          note: 'Stored locally. No network.',
          doneTitle: 'Reply finished',
          askTitle: 'Needs your input',
          doneBody: '“%s” finished this turn',
          batchTitle: '%d conversations finished',
          batchBody: '%s finished',
          askBody: '“%s” · %s',
          q: 'a question is waiting',
          plan: 'a plan is waiting for review',
          approval: 'an approval request is waiting',
          testDoneBody: 'Test · this turn finished',
          testAttentionBody: 'Test · an approval is waiting',
        },
      };

      var ctx = null;
      var listStore = null;
      var listSub = null;
      var statusStore = null;
      var statusSub = null;
      var timer = null;

      var prevRunning = Object.create(null); // sid -> bool, baseline on first sight
      var seenPending = Object.create(null); // sid -> interaction key
      var quieted = Object.create(null); // key -> { sid, kind }, awaiting "left the page"
      var live = new Map(); // tag -> Notification
      var askNotes = new Map(); // interaction key -> Notification

      function log() {
        try {
          console.log.apply(console, ['[dsh-ping]'].concat(Array.prototype.slice.call(arguments)));
        } catch (e) {}
      }

      function lang() {
        try {
          var locale = service('locale');
          var l = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null;
          if (l) return String(l).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
        } catch (e) {}
        try {
          var n = root.navigator && root.navigator.language;
          if (n) return String(n).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
        } catch (e) {}
        return 'zh';
      }

      function tr(key) {
        var table = UI[lang()] || UI.zh;
        return table[key] || UI.zh[key] || key;
      }

      function fmt(text, a, b) {
        var out = String(text == null ? '' : text);
        if (a !== undefined) out = out.replace('%s', a).replace('%d', a);
        if (b !== undefined) out = out.replace('%s', b);
        return out;
      }

      function readConfig() {
        var c = { enabled: DEFAULTS.enabled, done: DEFAULTS.done, attention: DEFAULTS.attention, sound: DEFAULTS.sound };
        try {
          var raw = root.localStorage && root.localStorage.getItem(CONFIG_KEY);
          if (!raw) return c;
          var o = JSON.parse(raw);
          if (!o || typeof o !== 'object') return c;
          if (typeof o.enabled === 'boolean') c.enabled = o.enabled;
          if (typeof o.sound === 'boolean') c.sound = o.sound;
          if (o.done === 'away' || o.done === 'always' || o.done === 'off') c.done = o.done;
          if (o.attention === 'away' || o.attention === 'always' || o.attention === 'off') c.attention = o.attention;
        } catch (e) {}
        return c;
      }

      function writeConfig(c) {
        try {
          if (root.localStorage) root.localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
        } catch (e) {
          log('could not persist config', e);
        }
      }

      // Away = the user is not looking at this page.
      function away() {
        try {
          return document.hidden || document.visibilityState === 'hidden' || !document.hasFocus();
        } catch (e) {
          return true;
        }
      }

      // The Electron shell exposes no focus API; navigating a hidden iframe to
      // dsh://open is the path the shell's open-url handler listens for.
      function raise() {
        try {
          var frame = document.createElement('iframe');
          frame.style.display = 'none';
          frame.src = 'dsh://open';
          (document.body || document.documentElement).appendChild(frame);
          setTimeout(function () {
            try {
              frame.remove();
            } catch (e) {}
          }, 1500);
        } catch (e) {}
        try {
          window.focus();
        } catch (e) {}
      }

      // Bring the window forward and open the alerted conversation.
      function focusSession(sid) {
        raise();
        if (!sid) return;
        try {
          var st = listStore && listStore.getSnapshot();
          if (st && st.byId && !st.byId[sid]) return;
          var sessions = service('sessions');
          if (sessions && typeof sessions.open === 'function') {
            sessions.open(sid);
            return;
          }
          var workspace = service('uiWorkspace');
          if (workspace && typeof workspace.openSession === 'function') workspace.openSession(sid);
        } catch (e) {
          log('open session failed', e);
        }
      }

      function closeNote(n) {
        try {
          if (n && typeof n.close === 'function') n.close();
        } catch (e) {}
      }

      function canNotify() {
        if (!('Notification' in root)) return false;
        return Notification.permission !== 'denied';
      }

      // The host half owns the sound: spawning afplay is the only way to get
      // macOS's own alert instead of a browser-synthesized beep. A missing
      // route or a non-macOS host simply means silence; the notification still
      // shows.
      function playSound() {
        try {
          if (typeof root.fetch !== 'function') return;
          var req = root.fetch('/__dsh-ping/sound', {
            method: 'POST',
            headers: { 'x-dsh-ping': 'sound' },
          });
          if (req && typeof req.catch === 'function') req.catch(function () {});
        } catch (e) {}
      }

      function show(o) {
        if (!canNotify()) return null;
        if (readConfig().sound) playSound();
        try {
          if (Notification.permission === 'default' && typeof Notification.requestPermission === 'function') {
            try {
              Notification.requestPermission();
            } catch (e) {}
          }
          var n = new Notification(o.title, {
            body: o.body,
            tag: o.tag,
            requireInteraction: !!o.urgent,
            silent: true,
          });
          var forget = function () {
            if (live.get(o.tag) === n) live.delete(o.tag);
            if (o.key && askNotes.get(o.key) === n) askNotes.delete(o.key);
          };
          n.onclick = function () {
            closeNote(n);
            forget();
            focusSession(o.sid);
          };
          n.onclose = forget;
          n.onerror = function () {
            log('notification failed', n);
          };
          var old = live.get(o.tag);
          if (old && old !== n) closeNote(old);
          live.set(o.tag, n);
          if (o.key) askNotes.set(o.key, n);
          while (live.size > MAX_LIVE) {
            var oldestTag = live.keys().next().value;
            var oldest = live.get(oldestTag);
            live.delete(oldestTag);
            askNotes.forEach(function (note, key) {
              if (note === oldest) askNotes.delete(key);
            });
            closeNote(oldest);
          }
          return n;
        } catch (e) {
          log('notify threw', e);
          return null;
        }
      }

      function labelFor(sid) {
        try {
          var st = listStore && listStore.getSnapshot();
          var row = st && st.byId && st.byId[sid];
          if (row) return row.displayTitle || row.title || sid;
        } catch (e) {}
        return sid;
      }

      function isSubagent(row) {
        return !!row && (row.origin === 'subagent' || !!row.parentId);
      }

      function attentionAllowed(cfg) {
        if (!cfg.enabled || cfg.attention === 'off') return false;
        if (cfg.attention === 'always') return true;
        return away();
      }

      function doneAllowed(cfg) {
        if (!cfg.enabled || cfg.done === 'off') return false;
        if (cfg.done === 'always') return true;
        return away();
      }

      // ── reply finished ────────────────────────────────────────────────
      function reportDone(items) {
        if (!items.length) return;
        var cfg = readConfig();
        if (!doneAllowed(cfg)) return;
        if (items.length === 1) {
          show({
            tag: 'done:' + items[0].sid,
            title: tr('doneTitle'),
            body: fmt(tr('doneBody'), items[0].label),
            sid: items[0].sid,
          });
          return;
        }
        var names = [];
        for (var i = 0; i < items.length && i < 3; i++) names.push('「' + items[i].label + '」');
        var suffix = items.length > 3 ? ' 等 ' + items.length + ' 个会话' : '';
        show({
          tag: 'done:batch',
          title: fmt(tr('batchTitle'), items.length),
          body: fmt(tr('batchBody'), names.join('、') + suffix),
        });
      }

      function onList() {
        try {
          var st = listStore && listStore.getSnapshot();
          var byId = (st && st.byId) || {};
          var sid, row, running, was;
          var finished = [];
          for (sid in byId) {
            row = byId[sid];
            if (!row) continue;
            running = !!row.running;
            was = prevRunning[sid];
            if (was === undefined) {
              prevRunning[sid] = running;
              continue;
            }
            prevRunning[sid] = running;
            if (!was || running) continue;
            if (isSubagent(row)) continue;
            finished.push({ sid: sid, label: labelFor(sid) });
          }
          for (sid in prevRunning) {
            if (!(sid in byId)) delete prevRunning[sid];
          }
          reportDone(finished);
        } catch (e) {
          log('list handler failed', e);
        }
      }

      // ── needs you (approval / plan review / question) ─────────────────
      function pendingText(kind) {
        if (kind === 'question') return tr('q');
        if (kind === 'plan-review') return tr('plan');
        return tr('approval');
      }

      function showAsk(sid, key, kind) {
        show({
          tag: 'ask:' + key,
          title: tr('askTitle'),
          body: fmt(tr('askBody'), labelFor(sid), pendingText(kind)),
          urgent: true,
          key: key,
          sid: sid,
        });
      }

      // Pending interactions that appeared while the user was looking stay quiet
      // under the "only when away" policy, and flush the moment the page loses
      // focus or becomes hidden.
      function flushQuieted() {
        var cfg = readConfig();
        if (!cfg.enabled || cfg.attention !== 'away' || !away()) return;
        Object.keys(quieted).forEach(function (key) {
          var q = quieted[key];
          delete quieted[key];
          if (!q || seenPending[q.sid] !== key) return;
          showAsk(q.sid, key, q.kind);
        });
      }

      function onStatus() {
        try {
          var snap = statusStore && statusStore.getSnapshot();
          if (!snap || typeof snap.forEach !== 'function') return;
          var cfg = readConfig();
          var seenSid = Object.create(null);
          var seenKey = Object.create(null);
          snap.forEach(function (value, sid) {
            var it = value && value.pendingInteraction;
            if (!it) return;
            seenSid[sid] = true;
            var key = it.key || (it.kind || 'approval') + ':' + sid;
            seenKey[key] = true;
            if (seenPending[sid] === key) return;
            seenPending[sid] = key;
            if (attentionAllowed(cfg)) {
              showAsk(sid, key, it.kind || 'approval');
            } else if (cfg.enabled && cfg.attention === 'away') {
              quieted[key] = { sid: sid, kind: it.kind || 'approval' };
            }
          });
          for (var sid2 in seenPending) {
            if (!seenSid[sid2]) delete seenPending[sid2];
          }
          Object.keys(quieted).forEach(function (key) {
            if (!seenKey[key]) delete quieted[key];
          });
          askNotes.forEach(function (note, key) {
            if (seenKey[key]) return;
            askNotes.delete(key);
            live.delete('ask:' + key);
            closeNote(note);
          });
        } catch (e) {
          log('status handler failed', e);
        }
      }

      // ── service binding (services may activate after this plugin) ─────
      function service(name) {
        try {
          if (ctx && typeof ctx.get === 'function') return ctx.get(name) || null;
        } catch (e) {}
        try {
          return (ctx && ctx[name]) || null;
        } catch (e) {
          return null;
        }
      }

      function isStore(s) {
        return !!s && typeof s.getSnapshot === 'function' && typeof s.subscribe === 'function';
      }

      function bind() {
        if (!listStore) {
          var sessions = service('sessions');
          if (sessions && isStore(sessions.list)) {
            listStore = sessions.list;
            listSub = listStore.subscribe(onList);
            onList();
            log('bound sessions.list');
          }
        }
        if (!statusStore) {
          var ui = service('uiSession');
          var store = ui && (ui.sessionStatus || ui.pendingInteractions);
          if (isStore(store)) {
            statusStore = store;
            statusSub = statusStore.subscribe(onStatus);
            onStatus();
            log('bound uiSession status');
          }
        }
        if (listStore && statusStore && timer) {
          clearInterval(timer);
          timer = null;
        }
      }

      function testNotify(kind) {
        var attention = kind === 'attention';
        show({
          tag: 'test:' + kind,
          title: tr(attention ? 'askTitle' : 'doneTitle'),
          body: tr(attention ? 'testAttentionBody' : 'testDoneBody'),
          urgent: attention,
        });
      }

      // ── settings page ─────────────────────────────────────────────────
      var rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '6px 0' };
      var labelStyle = { display: 'flex', flexDirection: 'column', gap: '2px' };
      var hintStyle = { opacity: 0.65, fontSize: '12px' };
      var controlStyle = { padding: '4px 8px', borderRadius: '6px', border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'transparent', color: 'inherit', font: 'inherit' };
      var buttonStyle = { padding: '5px 10px', borderRadius: '6px', border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' };

      function SettingsView(props) {
        var t = props.t;
        var state = React.useState(function () {
          return readConfig();
        });
        var cfg = state[0];
        var setCfg = state[1];

        function patch(p) {
          var next = Object.assign({}, cfg, p);
          setCfg(next);
          writeConfig(next);
        }

        function select(name, value, items) {
          return React.createElement(
            'select',
            {
              value: value,
              style: controlStyle,
              onChange: function (e) {
                var p = {};
                p[name] = e.target.value;
                patch(p);
              },
            },
            items.map(function (item) {
              return React.createElement('option', { key: item.value, value: item.value }, item.label);
            }),
          );
        }

        function checkbox(name, checked) {
          return React.createElement('input', {
            type: 'checkbox',
            checked: checked,
            style: { width: '16px', height: '16px' },
            onChange: function (e) {
              var p = {};
              p[name] = !!e.target.checked;
              patch(p);
            },
          });
        }

        function row(label, hint, control) {
          return React.createElement(
            'div',
            { style: rowStyle },
            React.createElement(
              'div',
              { style: labelStyle },
              React.createElement('span', null, label),
              hint ? React.createElement('span', { style: hintStyle }, hint) : null,
            ),
            control,
          );
        }

        var policyItems = [
          { value: 'away', label: t('away') },
          { value: 'always', label: t('always') },
          { value: 'off', label: t('off') },
        ];

        return React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' } },
          row(t('enabled'), null, checkbox('enabled', cfg.enabled)),
          row(t('done'), null, select('done', cfg.done, policyItems)),
          row(t('attention'), null, select('attention', cfg.attention, policyItems)),
          row(t('sound'), t('soundHint'), checkbox('sound', cfg.sound)),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', paddingTop: '6px', flexWrap: 'wrap' } },
            React.createElement('button', { type: 'button', style: buttonStyle, onClick: function () { props.test('done'); } }, t('testDone')),
            React.createElement('button', { type: 'button', style: buttonStyle, onClick: function () { props.test('attention'); } }, t('testAttention')),
          ),
          React.createElement('div', { style: hintStyle }, t('note')),
        );
      }

      function installSettings() {
        var slots = service('slots');
        var locale = service('locale');
        if (!React || !ctx || !slots || typeof slots.inject !== 'function') return;
        var t = tr;
        try {
          if (locale && typeof locale.register === 'function') {
            if (typeof ctx.effect === 'function') {
              ctx.effect(function () {
                return locale.register(NS, { zh: UI.zh, en: UI.en });
              }, 'dsh-ping: dictionaries');
            }
            if (typeof locale.bind === 'function') t = locale.bind(NS);
          }
        } catch (e) {
          log('locale registration failed', e);
        }
        try {
          slots.inject('settings.section', function () {
            var dispose = slots.register(
              {
                name: 'settings.section',
                id: NS,
                order: 46,
                label: function () {
                  return t('nav');
                },
                locale: NS,
                inject: function () {
                  return { t: t };
                },
              },
              function () {
                return React.createElement(SettingsView, { t: t, test: testNotify });
              },
            );
            log('settings registered');
            return dispose;
          });
        } catch (e) {
          log('settings page unavailable', e);
        }
      }

      function apply(rootCtx) {
        ctx = rootCtx;
        try {
          if ('Notification' in root && Notification.permission === 'default' && typeof Notification.requestPermission === 'function') {
            Notification.requestPermission();
          }
        } catch (e) {}

        var onVisibility = function () {
          flushQuieted();
        };
        var onBlur = function () {
          setTimeout(flushQuieted, 50);
        };
        try {
          document.addEventListener('visibilitychange', onVisibility);
        } catch (e) {}
        try {
          root.addEventListener('blur', onBlur);
        } catch (e) {}

        var stop = function () {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          try {
            document.removeEventListener('visibilitychange', onVisibility);
          } catch (e) {}
          try {
            root.removeEventListener('blur', onBlur);
          } catch (e) {}
          try {
            if (listSub) listSub();
          } catch (e) {}
          try {
            if (statusSub) statusSub();
          } catch (e) {}
          listSub = null;
          statusSub = null;
          listStore = null;
          statusStore = null;
          live.forEach(closeNote);
          live.clear();
          askNotes.clear();
          quieted = Object.create(null);
        };

        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(function () {
            timer = setInterval(bind, 1500);
            bind();
            return stop;
          }, 'dsh-ping: watchers');
        } else {
          timer = setInterval(bind, 1500);
          bind();
        }

        try {
          installSettings();
        } catch (e) {
          log('settings init failed', e);
        }

        root.__dshPing = {
          test: testNotify,
          state: function () {
            return {
              listStore: !!listStore,
              statusStore: !!statusStore,
              away: away(),
              permission: 'Notification' in root ? Notification.permission : 'unsupported',
              config: readConfig(),
              trackedSessions: Object.keys(prevRunning).length,
              pendingSessions: Object.keys(seenPending).length,
              quieted: Object.keys(quieted).length,
              liveNotifications: live.size,
              timers: {
                retry: !!timer,
              },
            };
          },
        };
        log('loaded');
      }

      exports.inject = ['sessions'];
      exports.apply = apply;
      return module.exports;
    },
  });
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null);
