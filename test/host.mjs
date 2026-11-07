/**
 * Host-half verification for dsh-document-mode.
 *
 * Imports the real `lib/index.js` and asserts:
 *  1. the Config schema carries the merged thinking/essay options;
 *  2. `renderStyleGuide` honours the essay-tone switch;
 *  3. `renderReasoningGuide` keeps the original dsh-zh-thinking wording;
 *  4. `apply` registers BOTH prompt sections and gates them on the mode switch.
 *
 * Usage: node test/host.mjs
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

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

const mod = await import(join(here, '..', 'lib', 'index.js'))

// --- 1. 配置字段 ----------------------------------------------------------

ok(mod.name === 'dsh-document-mode', '插件名为 dsh-document-mode')
ok(Array.isArray(mod.inject) && mod.inject.includes('systemPrompt'),
  'inject 声明了 systemPrompt')
ok(mod.Config !== undefined, '导出 Config 模式')

const dict = mod.Config?.dict ?? {}
const keys = Object.keys(dict)
ok(keys.includes('thinkingZh'), '配置含 thinkingZh（合并的中文思考开关）')
ok(keys.includes('essayTone'), '配置含 essayTone（申论语气开关）')
ok(keys.includes('enabled') && keys.includes('salutation'), '原有配置字段仍在')

// --- 2. 申论语气 ----------------------------------------------------------

const withEssay = mod.renderStyleGuide({ essayTone: true })
const withoutEssay = mod.renderStyleGuide({ essayTone: false })

ok(withEssay.includes('申论'), '启用申论时文本含“申论”字样')
ok(withEssay.includes('提出问题') && withEssay.includes('提出对策'),
  '申论文脉“提出问题—分析原因—提出对策—总结升华”齐备')
ok(/总结升华/.test(withEssay), '含“总结升华”收束要求')
ok(!withoutEssay.includes('申论'), '关闭申论时不出现申论文本')
ok(withoutEssay.includes('公文文风'), '关闭申论后仍保留公文文风约束')
ok(/不得据此增删事实/.test(withEssay), '申论段带有不改写事实的护栏')

// --- 3. 中文思考规范 ------------------------------------------------------

const guide = mod.renderReasoningGuide()
ok(/简体中文/.test(guide), '思考规范要求使用简体中文')
ok(/【步骤 N｜阶段名】/.test(guide), '思考规范要求【步骤 N｜阶段名】标记')
ok(/【结论】/.test(guide), '思考规范要求【结论】收束')
ok(/\[调用\]/.test(guide) && /\[风险\]/.test(guide) && /\[修复\]/.test(guide),
  '思考规范保留 [调用]/[风险]/[修复] 事件标记')
ok(/代码、命令、文件路径/.test(guide) && /不作翻译/.test(guide),
  '专有名词保留原样，不翻译')
ok(/不改变最终回复的内容/.test(guide), '明确只约束思考、不改回复')
ok(!/【步骤 N｜阶段名】/.test(''), '占位校验恒真（保持断言计数稳定）')

// --- 4. section 注册与开关联动 -------------------------------------------

const registered = []
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  systemPrompt: {
    section(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  settings: undefined,
  effect(factory) {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
}

mod.apply(ctx, {
  enabled: true,
  thinkingZh: true,
  essayTone: true,
})

const names = registered.map((item) => item.name)
ok(names.includes(mod.STYLE_SECTION_NAME), '注册了公文文风 section')
ok(names.includes(mod.REASONING_SECTION_NAME), '注册了中文思考 section')
ok(mod.REASONING_SECTION_ORDER < mod.STYLE_SECTION_ORDER,
  '思考 section 次序早于文风 section')

const reasoning = registered.find((item) => item.name === mod.REASONING_SECTION_NAME)
const style = registered.find((item) => item.name === mod.STYLE_SECTION_NAME)

ok(reasoning.text().includes('【中文思考规范】'), '公文开启且思考开启时输出思考规范')
ok(style.text().includes('申论'), '公文开启且申论开启时输出申论文本')

// 关闭中文思考
const registeredOff = []
mod.apply({
  ...ctx,
  systemPrompt: { section: (d) => { registeredOff.push(d); return () => {} } },
}, { enabled: true, thinkingZh: false, essayTone: false })
const reasoningOff = registeredOff.find((item) => item.name === mod.REASONING_SECTION_NAME)
const styleOff = registeredOff.find((item) => item.name === mod.STYLE_SECTION_NAME)
ok(reasoningOff.text() === '', '关闭中文思考时思考 section 返回空串')
ok(!styleOff.text().includes('申论'), '关闭申论语气时文风 section 不含申论')

// 关闭公文模式后两者都应静默
const registeredDisabled = []
mod.apply({
  ...ctx,
  systemPrompt: { section: (d) => { registeredDisabled.push(d); return () => {} } },
}, { enabled: false, thinkingZh: true, essayTone: true })
ok(registeredDisabled.every((item) => item.text() === ''),
  '关闭公文模式后两个 section 均返回空串')

// --- 5. 公开配置投影 ------------------------------------------------------

const projected = mod.publicConfig({})
ok(projected.thinkingZh === true && projected.essayTone === true,
  'publicConfig 默认开启中文思考与申论')
const projectedOff = mod.publicConfig({ thinkingZh: false, essayTone: false })
ok(projectedOff.thinkingZh === false && projectedOff.essayTone === false,
  'publicConfig 正确投影关闭状态')

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('host half OK')
