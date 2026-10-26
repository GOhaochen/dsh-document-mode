/**
 * Static + behavioural verification for dsh-document-mode's browser half.
 *
 * Runs the real `lib/client.js` under a minimal DOM/React stub, then asserts
 * the stylesheet, the root-attribute scoping, and the three slot registrations.
 * Also extracts the 圈阅 classifier from the shipped source and checks its
 * circle/cross decisions.
 *
 * Usage: node test/verify.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CLIENT = join(root, 'lib', 'client.js')

let failures = 0
let checks = 0

function ok(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// Minimal DOM
// ---------------------------------------------------------------------------

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.attributes = new Map()
    this.dataset = {}
    this.style = {}
    this.textContent = ''
    this.parent = null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      this.dataset[key] = String(value)
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  appendChild(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this)
      this.parent = null
    }
  }

  querySelector() { return null }
}

const head = new FakeElement('head')
const rootElement = new FakeElement('html')
const body = new FakeElement('body')

globalThis.document = {
  documentElement: rootElement,
  head,
  body,
  createElement: (tag) => new FakeElement(tag),
  querySelector: (selector) => {
    for (const child of head.children) {
      if (selector.includes('data-plugin-css') && child.dataset.pluginCss === 'dsh-document-mode-style') return child
    }
    return null
  },
  querySelectorAll: () => [],
}

const intervals = []
const timeouts = []

globalThis.window = {
  __ModuleLoader__: {},
  setTimeout: (fn) => { timeouts.push(fn); return timeouts.length },
  clearTimeout: () => {},
  setInterval: (fn) => { intervals.push(fn); return intervals.length },
  clearInterval: () => {},
}

globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

// ---------------------------------------------------------------------------
// Minimal React
// ---------------------------------------------------------------------------

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useReducer: (_reducer, initial) => [initial, () => {}],
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
  memo: (fn) => fn,
}

const requireStub = (name) => {
  if (name === 'react') return ReactStub
  throw new Error(`unexpected require('${name}')`)
}

// ---------------------------------------------------------------------------
// Load the shipped bundle
// ---------------------------------------------------------------------------

console.log('dsh-document-mode — browser half verification\n')

const source = readFileSync(CLIENT, 'utf8')

let captured
globalThis.window.__ModuleLoader__.load = (definition) => { captured = definition }

let loadError
try {
  // The bundle is a classic script, not an ES module.
  new Function('window', 'document', 'MutationObserver', 'fetch', 'EventSource', 'console', source)(
    globalThis.window,
    globalThis.document,
    globalThis.MutationObserver,
    globalThis.fetch,
    undefined,
    console,
  )
} catch (error) {
  loadError = error
}

ok(!loadError, 'bundle evaluates as a classic script', loadError && loadError.message)
ok(captured !== undefined, 'registers through window.__ModuleLoader__')
ok(captured?.id === 'dsh-document-mode', 'module id equals the npm package name', captured?.id)

const api = captured?.factory(requireStub)
ok(typeof api?.apply === 'function', 'exports apply()')
ok(Array.isArray(api?.inject) && api.inject.includes('slots'), 'exports inject: [slots]')

// ---------------------------------------------------------------------------
// apply() under a fake cordis context
// ---------------------------------------------------------------------------

const registrations = []
let styleTag

const fakeCtx = {
  effect: (fn) => { fn() },
  slots: {
    inject: (name, callback) => { callback() },
    register: (options, Component) => { registrations.push({ options, Component }) },
  },
}

let applyError
try {
  api.apply(fakeCtx)
} catch (error) {
  applyError = error
}

ok(!applyError, 'apply() runs without throwing', applyError && applyError.message)
ok(rootElement.getAttribute('data-dsh-doc-mode') === 'on', 'root starts at data-dsh-doc-mode="on" (default enabled)')

styleTag = head.children.find((child) => child.dataset.pluginCss === 'dsh-document-mode-style')
ok(styleTag !== undefined, 'injects one stylesheet')
ok(styleTag?.dataset.plugin === 'dsh-document-mode', 'stylesheet carries data-plugin for HMR cleanup')

const css = styleTag?.textContent ?? ''
ok(css.includes('html[data-dsh-doc-mode="on"] :is([data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"])'),
  'row rules are fully scoped (no unscoped leading selector)')
ok(!/(^|\n)\s*\[data-chat-flow-kind/.test(css), 'no unscoped [data-chat-flow-kind] selector leaks')
ok(css.includes('attr(data-doc-head)'), '发文机关标志 uses attr(data-doc-head)')
ok(css.includes('attr(data-doc-issue)'), '发文字号 uses attr(data-doc-issue)')
ok(css.includes('attr(data-doc-sign)'), '署名/成文日期 uses attr(data-doc-sign)')
ok(css.includes('attr(data-doc-title)') && css.includes('attr(data-doc-salutation)'),
  '标题 + 主送机关 use their attributes')
ok(css.includes('display: flex !important'), 'slot anchor is promoted from display:contents to a flex column')
ok(css.includes('.dsh-doc-sealpad canvas'), '圈阅 pad styles present')
ok(/\.dsh-doc-sealpad\s*\{[^}]*width:\s*240px/.test(css) && /\.dsh-doc-sealpad\s*\{[^}]*height:\s*80px/.test(css),
  '圈阅画板尺寸为 240×80（远大于单个按钮）')

// --- GB/T 9704—2012 版面参数 ---
const rowRule = css.match(/html\[data-dsh-doc-mode="on"\] :is\(\[data-chat-flow-kind="assistant"\][^}]*?\}/s)?.[0] ?? ''
ok(rowRule.includes('width: min(37.2em, 100%)'), 'A4 幅面宽度 210mm（版心156+左28+右26）换算为 37.2em')
ok(rowRule.includes('padding: 1.8em 4.784em 3.4em 4.784em'),
  '左右各 27mm → 版心 156mm；上下留白收敛，消除每页顶部大片空白')
ok(rowRule.includes('font-size: calc(16pt * var(--dsh-doc-scale))'), '正文基准为 3 号（16pt）')
ok(rowRule.includes('line-height: 1.812'), '行距 225mm÷22行 ≈ 29pt ≈ 1.812em')
ok(rowRule.includes('color: #000'), '公文字色为黑（标准 5.2.4）')
ok(/\[data-doc-head-on="1"\]::before\s*\{[^}]*margin-top:\s*1\.812em/s.test(css),
  '版头区收敛为空一行（标准 35mm 是给份号／密级预留的）')
ok(/\[data-doc-issue-on="1"\]::before\s*\{[^}]*padding-bottom:\s*0\.7087em/s.test(css),
  '发文字号下 4mm（0.7087em）处印红色分隔线')
ok(/\[data-doc-issue-on="1"\]::before\s*\{[^}]*border-bottom:\s*2px solid var\(--dsh-doc-red\)/s.test(css),
  '红色分隔线与版心等宽')
ok(/\[data-doc-issue-on="1"\]::before\s*\{[^}]*content:\s*attr\(data-doc-issue\)/s.test(css)
  && /setDocAttr\(node, 'data-doc-issue'/.test(source)
  && /setDocAttr\(node, 'data-doc-issue-on'/.test(source),
  '发文字号属性写在槽位锚点上，与 attr()／门控选择器同元素')
ok(/data-doc-title-on="1"\]::before\s*\{[^}]*margin-top:\s*3\.624em/s.test(css),
  '标题位于红色分隔线下空二行')
ok(/font-size:\s*1\.375em/.test(css), '标题 2 号（22pt）小标宋')
ok(/data-doc-title-on="1"\]::after\s*\{[^}]*margin-top:\s*1\.812em/s.test(css),
  '主送机关位于标题下空一行')
ok(/p\s*\{[^}]*text-indent:\s*2em/s.test(css), '正文每自然段左空二字')
ok(/\[data-doc-sign-on="1"\]::after\s*\{[^}]*padding-right:\s*4em/s.test(css), '成文日期右空四字')
ok(/--dsh-doc-heiti/.test(css) && /--dsh-doc-kaiti/.test(css) && /--dsh-doc-xiaobiaosong/.test(css),
  '字体栈含小标宋／仿宋／黑体／楷体')

// 本机已装入真正的公章四体，字体栈必须以标准名打头；开源替代字体已移除。
const fangsongStack = css.match(/--dsh-doc-fangsong:\s*([^;]+);/s)?.[1] ?? ''
const kaitiStack = css.match(/--dsh-doc-kaiti:\s*([^;]+);/s)?.[1] ?? ''
const heitiStack = css.match(/--dsh-doc-heiti:\s*([^;]+);/s)?.[1] ?? ''
const xiaobiaosongStack = css.match(/--dsh-doc-xiaobiaosong:\s*([^;]+);/s)?.[1] ?? ''
ok(/^\s*"仿宋"/.test(fangsongStack), '正文栈以真「仿宋」打头')
ok(/^\s*"楷体"/.test(kaitiStack), '楷体栈以真「楷体」打头')
ok(/^\s*"黑体"/.test(heitiStack), '黑体栈以真「黑体」打头')
ok(/^\s*"方正小标宋简体"/.test(xiaobiaosongStack), '标题栈以「方正小标宋简体」打头')
ok(!/Zhuque Fangsong/.test(source), '已彻底移除朱雀仿宋的族名引用')
ok(!/朱雀仿宋/.test(fangsongStack) && !/霞鹜文楷/.test(kaitiStack),
  '仿宋／楷体栈中不再包含开源替代字体')

// --- 公文纸自持配色：暗色主题/皮肤不得把浅字与深色半透明底带进白纸 ---
ok(rowRule.includes('--dsw-alias-label-primary: #000'),
  '公文页内重声明 --dsw-alias-label-primary 为黑色')
ok(rowRule.includes('--dsw-alias-markdown-inline-code: #f0f0f0')
  && rowRule.includes('--dsw-alias-markdown-code-block: #f4f4f4'),
  '公文页内重声明 markdown 代码类 token 为浅色底')
ok(rowRule.includes('--dsw-alias-markdown-code-segment-selected')
  && rowRule.includes('--dsw-alias-border-l1')
  && rowRule.includes('--dsw-alias-bg-mask-1: transparent'),
  '公文页内一并覆盖边框、遮罩与代码选中态 token')
ok(/-webkit-text-fill-color:\s*currentColor/.test(css) && /text-shadow:\s*none/.test(css),
  '中和 text-fill-color 与 text-shadow，消除半透明轮廓')

// --- 公文要素内容规则 ---
ok(/return `\$\{organisation\(\)\}/.test(source), '发文机关标志仅含机关名称')
ok(/state\.issueCode \|\| 'DSH'/.test(source) && /〔\$\{new Date\(\)\.getFullYear\(\)\}〕\$\{serial\}号/.test(source),
  '发文字号形如 代字〔年份〕N号（六角括号、年份全称、序号不编虚位）')
ok(/getAttribute\('data-chat-turn'\)/.test(source),
  '发文序号按会话轮次递增，不再恒为 1号')
ok(/function formatDate/.test(source) && /getMonth\(\) \+ 1\}月/.test(source),
  '成文日期使用阿拉伯数字、月日不编虚位')
ok(!/cnDate|CN_DIGITS/.test(source), '已移除汉字日期（2012 版已改为阿拉伯数字）')

const slotNames = registrations.map((r) => r.options.name)
ok(slotNames.filter((n) => n === 'conversation.input.left').length === 3,
  'registers three composer-left controls (mode / 圈阅 / 导出)')
ok(slotNames.filter((n) => n === 'conversation.input.dock').length === 1,
  'registers the full-width 圈阅 lane')
ok(slotNames.includes('settings.general.item'), 'registers the Settings → General row')
ok(registrations.every((r) => typeof r.Component === 'function'), 'every registration supplies a component')

// 圈阅栏的关闭与重开
ok(source.includes('data-doc-sealbar-close'), '圈阅栏带关闭按钮')
ok(/onClick:\s*\(\)\s*=>\s*setSealBarVisible\(false\)/.test(source), '关闭按钮调用 setSealBarVisible(false)')
ok(source.includes('data-doc-seal-toggle'), '工具栏有圈阅开关可重新展开')
ok(/localStorage\?\.setItem\('dsh-document-mode:sealbar'/.test(source), '圈阅栏开合状态持久化到 localStorage')
ok(/!mode\.enabled\s*\|\|\s*!sealBarVisible/.test(source), '圈阅栏在关闭或模式停用时渲染为空')

// DOCX 导出（纯前端生成）
const exportRegistration = registrations.find((r) => r.options.id === 'dsh-document-mode-export')
ok(exportRegistration !== undefined, '注册了「导出 DOCX」工具栏按钮')
ok(source.includes('function buildDocxBytes') && source.includes('function buildZip'),
  '含 ZIP 容器与 .docx 生成器')
ok(source.includes('word/document.xml') && source.includes('[Content_Types].xml'),
  '生成完整 OOXML 部件')
ok(/w:pgSz w:w="11906" w:h="16838"/.test(source) && /w:pgMar w:top="2098"/.test(source),
  'A4 幅面与 GB/T 9704 页边距写入 sectPr')
ok(/firstLineChars:\s*200/.test(source) && /rightChars:\s*400/.test(source)
  && /w:firstLineChars=/.test(source) && /w:rightChars=/.test(source),
  '正文首行缩进 2 字、落款右空 4 字写入 .docx')
ok(/DOCX_FONT = \{[\s\S]*?fangsong:\s*'仿宋'[\s\S]*?xiaobiaosong:\s*'方正小标宋简体'[\s\S]*?heiti:\s*'黑体'[\s\S]*?kaiti:\s*'楷体'/.test(source),
  '导出件使用标准公文字体名（仿宋／黑体／楷体／方正小标宋简体）')
ok(source.includes('__test'), '导出逻辑可通过 __test 钩子离线验证')

// 公文纸只落在每轮最终答复上（思考链不再出现白块）
ok(/const ROW = [^\n]*\[data-doc-paper="1"\]/.test(source),
  '全部版面规则由 data-doc-paper 门控')
ok(/function clearDecoration/.test(source), '提供撤销装饰的实现')
ok(/data-turn-process-hidden/.test(source), '折叠中被隐藏的过程节点不套纸')
ok(/const byTurn = new Map\(\)/.test(source) && /bucket\[bucket\.length - 1\]/.test(source),
  '按 data-chat-turn 分组，只给每轮最后一个节点套纸')
ok(/data-doc-paper/.test(css), '样式表里存在 data-doc-paper 门控')

// 白纸黑字强制归位（主题/皮肤运行时底色）
ok(/background-color:\s*transparent\s*!important/.test(css) && /color:\s*#000\s*!important/.test(css),
  '正文块强制透明底 + 黑字')
ok(/:not\(pre\) > code/.test(css), '行内代码单独恢复浅灰底')

// 公文标题拟"关于……的X"
ok(source.includes('function composeTitle') && source.includes('function deriveSubject'),
  '标题由"事由 + 文种"合成')
ok(source.includes("sessionTitle") && /props\?\.session\?\.title/.test(source),
  '事由可从会话标题取用')

// ---------------------------------------------------------------------------
// 圈阅 classifier, extracted from the shipped source
// ---------------------------------------------------------------------------

function extractFunction(text, name) {
  const start = text.indexOf(`function ${name}(`)
  if (start < 0) return ''
  const open = text.indexOf('{', start)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return ''
}

const classifySource = extractFunction(source, 'classifyStroke')
ok(classifySource !== '', 'classifyStroke is present in the shipped bundle')
const classify = new Function(`${classifySource}; return classifyStroke`)()

function circle(cx, cy, r, n = 48) {
  const points = []
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r })
  }
  points.push(points[0])
  return points
}

function cross(cx, cy, r, n = 24) {
  const points = []
  for (let i = 0; i <= n; i += 1) points.push({ x: cx - r + (2 * r * i) / n, y: cy - r + (2 * r * i) / n })
  for (let i = 0; i <= n; i += 1) points.push({ x: cx + r - (2 * r * i) / n, y: cy - r + (2 * r * i) / n })
  return points
}

ok(classify(circle(36, 33, 22)) === 'agree', 'a drawn circle reads as 同意')
ok(classify(cross(36, 33, 24)) === 'disagree', 'a drawn cross reads as 不同意')
ok(classify([{ x: 1, y: 1 }, { x: 2, y: 2 }]) === null, 'a near-empty stroke is inconclusive')
ok(classify(circle(36, 33, 22, 6)) === null, 'a tiny circle is inconclusive')

// ---------------------------------------------------------------------------
// 层次序数分层（GB/T 9704—2012 §7.3.3），从发行源码中提取
// ---------------------------------------------------------------------------

function extractConst(text, name) {
  const start = text.indexOf(`const ${name} = `)
  if (start < 0) return ''
  const open = text.indexOf('[', start)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1
    else if (text[i] === ']') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return ''
}

function fakeParagraph(text) {
  const attrs = new Map()
  return {
    textContent: text,
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => { attrs.set(n, String(v)) },
    hasAttribute: (n) => attrs.has(n),
    removeAttribute: (n) => { attrs.delete(n) },
    get level() { return attrs.get('data-doc-level') },
  }
}

const markLevelsSource = extractFunction(source, 'markLevels')
const setDocAttrSource = extractFunction(source, 'setDocAttr')
const levelPatternsSource = extractConst(source, 'LEVEL_PATTERNS')
ok(markLevelsSource !== '' && levelPatternsSource !== '' && setDocAttrSource !== '',
  'markLevels / LEVEL_PATTERNS / setDocAttr present in the bundle')

const markLevels = new Function(
  `${setDocAttrSource}; ${levelPatternsSource}; ${markLevelsSource}; return markLevels`,
)()

const paragraphs = [
  fakeParagraph('一、总体要求'),
  fakeParagraph('一、总体要求。坚持稳中求进，推动高质量发展。'),
  fakeParagraph('（二）重点任务'),
  fakeParagraph('1.加强组织领导'),
  fakeParagraph('（3）细化措施'),
  fakeParagraph('普通正文段落，不含层次序数。'),
]
markLevels({ querySelectorAll: () => paragraphs })

ok(paragraphs[0].level === '1', '一级序数「一、」→ 黑体层级')
ok(paragraphs[1].level === undefined, '序数与正文同段时不套层次字体（不被整段涂成黑体）')
ok(paragraphs[2].level === '2', '二级序数「（二）」→ 楷体层级')
ok(paragraphs[3].level === '3', '三级序数「1.」→ 仿宋层级')
ok(paragraphs[4].level === '4', '四级序数「（3）」→ 仿宋层级')
ok(paragraphs[5].level === undefined, '普通段落不标记层次')
ok(css.includes('[data-doc-level="1"]') && css.includes('--dsh-doc-heiti')
  && css.includes('[data-doc-level="2"]') && css.includes('--dsh-doc-kaiti'),
  '层次序数字体规则已注入样式表')

// ---------------------------------------------------------------------------
// 公文标题合成（GB/T 9704—2012 §7.3.1：关于 + 事由 + 文种）
// ---------------------------------------------------------------------------

const genresSource = extractConst(source, 'GENRES')
const deriveSubjectSource = extractFunction(source, 'deriveSubject')
const composeTitleSource = extractFunction(source, 'composeTitle')
const detectGenreSource = extractFunction(source, 'detectGenre')
ok(genresSource !== '' && deriveSubjectSource !== '' && composeTitleSource !== '' && detectGenreSource !== '',
  'GENRES / deriveSubject / composeTitle / detectGenre present in the bundle')

const levelConstMatch = source.match(/const LEVEL_HEADING_RE = [^\n]+/)
ok(levelConstMatch !== null, 'LEVEL_HEADING_RE present in the bundle')
const levelConstSource = levelConstMatch ? levelConstMatch[0] : 'const LEVEL_HEADING_RE = /$^/'

function makeComposeTitle(sessionTitle) {
  return new Function(
    'sessionTitle',
    'scheduleDecorate',
    `${genresSource}; ${levelConstSource}; ${detectGenreSource}; ${deriveSubjectSource}; ${composeTitleSource}; return composeTitle`,
  )(sessionTitle, () => {})
}

const detectGenre = new Function(`${detectGenreSource}; return detectGenre`)()
ok(detectGenre('妥否，请批示。') === '请示', '文种：征询批准 → 请示')
ok(detectGenre('此复。') === '批复', '文种：答复请示 → 批复')
ok(detectGenre('特此通知，请遵照执行。') === '通知', '文种：告知要求 → 通知')
ok(detectGenre('特此函告。') === '函', '文种：商洽事宜 → 函')
ok(detectGenre('特此通报。') === '通报', '文种：传达情况 → 通报')
ok(detectGenre('本次共完成四项工作。') === '报告', '文种：无收束语时回落报告')

const bodyWithHeading = (text) => ({ querySelector: () => ({ textContent: text }), textContent: text })
const bodyWithText = (text) => ({ querySelector: () => null, textContent: text })

const composeWithSession = makeComposeTitle('配置视频功能支持热启用禁用')
ok(composeWithSession(bodyWithHeading('项目交付情况')) === '关于项目交付情况的报告',
  '有标题时合成「关于……的报告」')
ok(composeWithSession(null) === '关于配置视频功能支持热启用禁用的报告',
  '无标题时以会话标题作事由')
ok(composeWithSession(bodyWithHeading('关于字体安装的报告')) === '关于字体安装的报告',
  '已以「关于」开头时不重复套壳')
ok(composeWithSession(bodyWithHeading('一、交付内容')) === '关于配置视频功能支持热启用禁用的报告',
  '层次序数标题不作事由，继续回落到会话标题（而非直接套用通用文种）')

const composeNoSession = makeComposeTitle('')
ok(composeNoSession(bodyWithText('收到。字体安装一事收束。本次共完成四项：……')) === '关于字体安装一事收束的报告',
  '会话标题缺失时取首句（剥掉「收到。」口语开场）')
ok(composeNoSession(bodyWithText('')) === '工作情况报告', '无任何来源时回落通用文种')

// 文种随内容变化，不再一律"报告"
const bodyWith = (headingText, fullText) => ({
  querySelector: () => (headingText ? { textContent: headingText } : null),
  textContent: fullText,
})
ok(composeWithSession(bodyWith('事项审批', '现将有关事项报上，妥否，请批示。')) === '关于事项审批的请示',
  '请示类回复 → 标题用"请示"')
ok(composeWithSession(bodyWith('来函答复', '关于你方来函，此复。')) === '关于来函答复的批复',
  '答复类回复 → 标题用"批复"')
ok(composeWithSession(bodyWith('工作安排', '现将有关要求通知如下，请遵照执行。')) === '关于工作安排的通知',
  '告知类回复 → 标题用"通知"')

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('browser half OK')
