import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * Load the browser half in a vm with fake DSH services.
 * @param {object} [options]
 * @param {boolean} [options.focused] - document.hasFocus()
 * @param {Record<string,string>} [options.storage] - initial localStorage
 * @param {boolean} [options.react] - provide a React stub and the settings slot
 * @param {boolean} [options.slots] - provide the slots service
 * @param {boolean} [options.locale] - provide the locale service
 */
export function loadPlugin(options = {}) {
  const notes = []
  const fetchCalls = []
  const listeners = {}
  const opened = []
  const disposers = []
  const focus = { value: options.focused !== false }
  const hidden = { value: false }
  const storage = new Map(Object.entries(options.storage ?? {}))
  let permission = options.permission ?? 'granted'

  function makeStore(initial) {
    let value = initial
    const subs = new Set()
    return {
      getSnapshot: () => value,
      subscribe(fn) {
        subs.add(fn)
        return () => subs.delete(fn)
      },
      set(next) {
        value = next
        for (const fn of [...subs]) fn()
      },
    }
  }

  const list = makeStore({ byId: {} })
  const status = makeStore(new Map())

  class FakeNotification {
    static get permission() {
      return permission
    }
    static requestPermission() {
      return Promise.resolve(permission)
    }
    constructor(title, opts) {
      this.title = title
      this.opts = opts ?? {}
      this.closed = false
      notes.push(this)
    }
    close() {
      this.closed = true
    }
  }

  const registered = []
  const fakeReact = options.react
    ? {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      }
    : null

  const slots =
    options.slots === false
      ? null
      : {
          inject(name, fn) {
            listeners['slot:' + name] = fn
          },
          register(opts, component) {
            registered.push({ opts, component })
            return () => {}
          },
        }

  const locale =
    options.locale === false
      ? null
      : {
          register: () => () => {},
          bind: () => (key) => key,
          getLocale: () => 'zh-CN',
        }

  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    __ModuleLoader__: {
      load(record) {
        sandbox.record = record
      },
    },
    Notification: FakeNotification,
    fetch(url, init) {
      fetchCalls.push({ url, init })
      return Promise.resolve({ ok: true })
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    document: {
      get hidden() {
        return hidden.value
      },
      visibilityState: 'visible',
      hasFocus: () => focus.value,
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
      createElement: () => ({ style: {}, remove() {} }),
      addEventListener: (type, fn) => {
        listeners[type] = fn
      },
      removeEventListener: (type) => {
        delete listeners[type]
      },
    },
    addEventListener: (type, fn) => {
      listeners['window:' + type] = fn
    },
    removeEventListener: (type) => {
      delete listeners['window:' + type]
    },
    setTimeout: (fn) => {
      fn()
      return 1
    },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    focus() {},
    navigator: { language: 'zh-CN' },
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  vm.runInContext(source, vm.createContext(sandbox))

  const record = sandbox.record
  const module = record.factory((name) => {
    if (name === 'react' && fakeReact) return fakeReact
    throw new Error('unexpected require: ' + name)
  })

  const ctx = {
    get(name) {
      if (name === 'sessions') return { list, open: (id) => opened.push(id) }
      if (name === 'uiSession') return { sessionStatus: status }
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      return null
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    slots,
    locale,
  }

  module.apply(ctx)
  if (options.react && listeners['slot:settings.section']) listeners['slot:settings.section']()

  return {
    module,
    notes,
    fetchCalls,
    listeners,
    opened,
    focus,
    hidden,
    storage,
    list,
    status,
    registered,
    state: () => sandbox.__dshPing.state(),
    test: (kind) => sandbox.__dshPing.test(kind),
    dispose() {
      for (const fn of disposers.splice(0)) fn()
    },
    setPermission(next) {
      permission = next
    },
  }
}
