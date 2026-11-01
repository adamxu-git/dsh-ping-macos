import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

const CONFIG_KEY = 'dshPing.config.v1'

function finish(list, id = 's1', title = '会话一') {
  list.set({ byId: { [id]: { running: true, title, origin: undefined } } })
  list.set({ byId: { [id]: { running: false, title, origin: undefined } } })
}

test('finished turn notifies while away, plays sound, and opens the session on click', () => {
  const p = loadPlugin({ focused: false })
  finish(p.list)
  assert.equal(p.notes.length, 1)
  assert.match(p.notes[0].title, /回复完成/)
  assert.equal(p.notes[0].opts.silent, true)
  assert.equal(p.fetchCalls.length, 1)
  assert.equal(p.fetchCalls[0].url, '/__dsh-ping-macos/sound')
  p.notes[0].onclick()
  assert.deepEqual(p.opened, ['s1'])
})

test('finished turn stays quiet while the page is focused', () => {
  const p = loadPlugin({ focused: true })
  finish(p.list)
  assert.equal(p.notes.length, 0)
})

test('needs-input notifies even while focused by default', () => {
  const p = loadPlugin({ focused: true })
  p.status.set(new Map([['s1', { pendingInteraction: { kind: 'approval', key: 'a1' } }]]))
  assert.equal(p.notes.length, 1)
  assert.match(p.notes[0].title, /需要你确认/)
  assert.equal(p.notes[0].opts.requireInteraction, true)
})

test('needs-input under "away" policy is queued and flushed when the page hides', () => {
  const p = loadPlugin({
    focused: true,
    storage: { [CONFIG_KEY]: JSON.stringify({ attention: 'away' }) },
  })
  p.status.set(new Map([['s1', { pendingInteraction: { kind: 'approval', key: 'a1' } }]]))
  assert.equal(p.notes.length, 0)
  assert.equal(p.state().quieted, 1)
  p.focus.value = false
  p.hidden.value = true
  p.listeners.visibilitychange()
  assert.equal(p.notes.length, 1)
  assert.equal(p.state().quieted, 0)
})

test('done can be switched off', () => {
  const p = loadPlugin({
    focused: false,
    storage: { [CONFIG_KEY]: JSON.stringify({ done: 'off' }) },
  })
  finish(p.list)
  assert.equal(p.notes.length, 0)
})

test('sound off issues no request', () => {
  const p = loadPlugin({
    focused: false,
    storage: { [CONFIG_KEY]: JSON.stringify({ sound: false }) },
  })
  finish(p.list)
  assert.equal(p.notes.length, 1)
  assert.equal(p.fetchCalls.length, 0)
})

test('background subagent sessions are muted', () => {
  const p = loadPlugin({ focused: false })
  p.list.set({ byId: { s1: { running: true, title: 'sub', origin: 'subagent' } } })
  p.list.set({ byId: { s1: { running: false, title: 'sub', origin: 'subagent' } } })
  assert.equal(p.notes.length, 0)
})

test('sticky notifications are capped', () => {
  const p = loadPlugin({ focused: true })
  const pending = new Map()
  for (let i = 0; i < 25; i++) pending.set('s' + i, { pendingInteraction: { kind: 'approval', key: 'k' + i } })
  p.status.set(pending)
  assert.equal(p.notes.length, 25)
  assert.equal(p.state().liveNotifications, 20)
})

test('dispose removes listeners and stops reporting', () => {
  const p = loadPlugin({ focused: false })
  finish(p.list)
  assert.equal(p.notes.length, 1)
  p.dispose()
  assert.equal(p.listeners.visibilitychange, undefined)
  finish(p.list, 's2', '会话二')
  p.status.set(new Map([['s3', { pendingInteraction: { kind: 'question', key: 'q1' } }]]))
  assert.equal(p.notes.length, 1)
})

test('default copy is Chinese, English is opt-in', () => {
  const zh = loadPlugin({ focused: false })
  finish(zh.list)
  assert.match(zh.notes[0].title, /回复完成/)
  const en = loadPlugin({
    focused: false,
    storage: { [CONFIG_KEY]: JSON.stringify({ lang: 'en' }) },
  })
  finish(en.list)
  assert.equal(en.notes[0].title, 'Reply finished')
  assert.equal(en.state().config.lang, 'en')
})

test('settings section registers and renders', () => {
  const p = loadPlugin({ react: true })
  assert.equal(p.registered.length, 1)
  assert.equal(p.registered[0].opts.id, 'dsh-ping-macos')
  assert.equal(p.registered[0].opts.name, 'settings.section')
  const element = p.registered[0].component()
  assert.equal(typeof element.type, 'function')
  const rendered = element.type(element.props)
  assert.equal(rendered.type, 'div')
})

test('Russian copy is opt-in and used for single notifications', () => {
  const p = loadPlugin({
    focused: false,
    storage: { [CONFIG_KEY]: JSON.stringify({ lang: 'ru' }) },
  })
  finish(p.list, 's1', 'Рефакторинг')
  assert.equal(p.notes[0].title, 'Ответ готов')
  assert.equal(p.notes[0].opts.body, '«Рефакторинг» — ход завершён')
  assert.equal(p.state().config.lang, 'ru')
})

test('batch summary punctuation follows the selected language', () => {
  const ids = ['s1', 's2', 's3', 's4']
  const finishMany = (p) => {
    p.list.set({ byId: Object.fromEntries(ids.map((id) => [id, { running: true, title: id }])) })
    p.list.set({ byId: Object.fromEntries(ids.map((id) => [id, { running: false, title: id }])) })
  }

  const zh = loadPlugin({ focused: false })
  finishMany(zh)
  assert.equal(zh.notes[0].title, '4 个会话完成')
  assert.equal(zh.notes[0].opts.body, '「s1」、「s2」、「s3」 等 4 个会话 已跑完')

  const en = loadPlugin({
    focused: false,
    storage: { [CONFIG_KEY]: JSON.stringify({ lang: 'en' }) },
  })
  finishMany(en)
  assert.equal(en.notes[0].opts.body, '“s1”, “s2”, “s3” (+4 more) finished')
  assert.doesNotMatch(en.notes[0].opts.body, /[「」、]|等/)

  const ru = loadPlugin({
    focused: false,
    storage: { [CONFIG_KEY]: JSON.stringify({ lang: 'ru' }) },
  })
  finishMany(ru)
  assert.equal(ru.notes[0].title, 'Готово диалогов: 4')
  assert.equal(ru.notes[0].opts.body, '«s1», «s2», «s3» и ещё 4 — готово')
})

test('settings offers Russian as a copy language', () => {
  const p = loadPlugin({ react: true })
  const element = p.registered[0].component()
  const rendered = element.type(element.props)
  const selects = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'select') {
      // the fake createElement keeps `items.map(...)` as a single child argument
      const options = (node.children ?? []).flat().map((o) => o?.children?.[0])
      selects.push({ value: node.props.value, options })
    }
    if (node.children) walk(node.children)
  }
  walk(rendered)
  const language = selects.find((s) => s.options.includes('Русский'))
  assert.ok(language, 'the language select should list Русский')
  assert.deepEqual(language.options, ['中文', 'English', 'Русский'])
})
