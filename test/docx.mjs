/**
 * DOCX 导出的端到端验证。
 *
 * 在 Node 里以最小 DOM 桩执行真实发行包中的 `buildDocxBytes()`，把产出的字节写成
 * /tmp/dsh-docmode-test.docx；随后由 test/run.sh 用 `unzip` 校验容器结构与内容，
 * 并用 `file` 确认 MIME 类型。
 *
 * 用法：node test/docx.mjs [输出路径]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const out = process.argv[2] || '/tmp/dsh-docmode-test.docx'

// --- 最小 DOM 桩 -----------------------------------------------------------

function element(tag, options = {}) {
  const children = options.children || []
  const childNodes = options.childNodes
    || (options.text !== undefined ? [{ nodeType: 3, nodeValue: options.text }] : [])
  const textContent = options.text !== undefined
    ? options.text
    : children.map((child) => child.textContent).join('')
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children,
    childNodes,
    textContent,
    querySelector: () => null,
    querySelectorAll: options.querySelectorAll || (() => []),
  }
}

function textNode(value) {
  return { nodeType: 3, nodeValue: value }
}

// 一份含各级元素的小样：正文段、带行内强调的段、列表、代码块、表格
const paragraph = element('p', { text: '本次共完成四项：安装字体、修正栈序、更新文档、回归测试。' })
const emphasized = element('p', {
  childNodes: [
    textNode('其一，'),
    element('strong', { childNodes: [textNode('重启浏览器')] }),
    textNode('使新字体进入字体清单；其二，重启一次 '),
    element('code', { text: 'dsh web' }),
    textNode(' 方可编辑机关代字。'),
  ],
})
const list = element('ul', {
  children: [
    element('li', { text: '圈阅栏新增关闭按钮' }),
    element('li', { text: '工具栏新增圈阅开关' }),
  ],
})
const code = element('pre', { text: 'dsh plugin --profile web add link:/path\n# 注释行' })
const rows = [
  element('tr', {
    children: [
      element('td', { text: '项目' }),
      element('td', { text: '状态' }),
    ],
  }),
  element('tr', {
    children: [
      element('td', { text: '公文模式' }),
      element('td', { text: '已完成' }),
    ],
  }),
]
const table = element('table', { children: rows, querySelectorAll: (sel) => (sel === 'tr' ? rows : []) })

const body = element('div', { children: [paragraph, emphasized, list, code, table] })
const node = element('div', { children: [body] })
node.firstElementChild = body

const row = {
  tagName: 'DIV',
  getAttribute: (name) => (name === 'data-chat-turn' ? '3' : null),
  querySelector: (sel) => (sel === '[data-slot="conversation.chat.node"]' ? node : null),
}

// --- 载入真实发行包 --------------------------------------------------------

const head = { children: [], appendChild(child) { this.children.push(child) } }
globalThis.document = {
  documentElement: { setAttribute() {}, getAttribute: () => null },
  head,
  body: { appendChild() {} },
  createElement: (tag) => ({ tagName: tag, dataset: {}, set textContent(v) { this._t = v }, get textContent() { return this._t } }),
  querySelector: () => null,
  querySelectorAll: () => [],
}
globalThis.window = {
  __ModuleLoader__: {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
globalThis.EventSource = undefined
globalThis.TextEncoder = TextEncoder

const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
let captured
globalThis.window.__ModuleLoader__.load = (definition) => { captured = definition }
new Function('window', 'document', 'MutationObserver', 'fetch', 'EventSource', 'console', source)(
  globalThis.window, globalThis.document, globalThis.MutationObserver, globalThis.fetch, undefined, console,
)

const ReactStub = {
  createElement: (type, props) => ({ type, props, children: [] }),
  useReducer: (_r, initial) => [initial, () => {}],
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
  memo: (fn) => fn,
}
const api = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error(`unexpected require ${name}`)
})

const t = api.__test
if (!t) {
  console.error('FAIL: 发行包未暴露 __test 钩子')
  process.exit(1)
}

// --- 生成并落盘 ------------------------------------------------------------

const bytes = t.buildDocxBytes(row)
writeFileSync(out, bytes)

const signature = Array.from(bytes.slice(0, 4))
console.log(JSON.stringify({
  out,
  bytes: bytes.length,
  zipSignature: signature,
  isZip: signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x03 && signature[3] === 0x04,
  safeName: t.safeFileName('关于字体安装的报告/2026年10月18日'),
  issue: t.buildIssueNumber(row),
}, null, 2))

if (!(signature[0] === 0x50 && signature[1] === 0x4B)) {
  console.error('FAIL: 不是 ZIP 容器')
  process.exit(1)
}
