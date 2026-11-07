/**
 * dsh-document-mode — host half.
 *
 * Owns three things:
 *  1. The formal-prose constraint contributed to the system prompt. The section
 *     is registered once with a *dynamic* text provider, so enabling/disabling
 *     the mode is a pure value flip — no re-registration, no reload.
 *  2. The persisted options. Every field is `.volatile()`, so a write through
 *     the settings service commits in place (the Loader emits
 *     `loader/volatile-update` instead of remounting the row) and lands in the
 *     active profile's Cordis patch, which makes a hot toggle survive restart.
 *  3. Two loopback-only HTTP endpoints the browser half uses:
 *       GET/POST /plugins/dsh-document-mode/config  — read / patch settings
 *       GET      /plugins/dsh-document-mode/events  — SSE state broadcast
 *
 * Everything host-side is defensive: a failure here must never abort DSH boot
 * or stop another plugin from loading.
 *
 * @module dsh-document-mode
 */
import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'dsh-document-mode'

/** Services this row needs before it can mount. */
export const inject = ['settings', 'systemPrompt', 'webServer']

/** Loopback-only endpoints consumed by the browser half. */
export const CONFIG_ENDPOINT = '/plugins/dsh-document-mode/config'
export const EVENTS_ENDPOINT = '/plugins/dsh-document-mode/events'

/**
 * Prompt-section seat. Registered once, evaluated on every assembly, and the
 * provider returns an empty string while the mode is off (empty sections are
 * dropped by assembly, so a disabled mode contributes nothing).
 */
export const STYLE_SECTION_NAME = 'dsh-document-mode:style'
export const STYLE_SECTION_ORDER = 10150

/**
 * 思考规范段落（合并自 dsh-zh-thinking）。
 *
 * 名称与次序沿用原插件，避免第三方按名引用时失配；order 450 位于部署人格
 * (0) 与计划策略 (500) 之间，属于行为引导的合适位置。
 * 仅当「公文模式启用」且「中文思考启用」时才输出正文，因此它是公文模式的
 * 附属能力：关闭公文模式即整体静默。
 */
export const REASONING_SECTION_NAME = 'dsh-zh-thinking:reasoning-style'
export const REASONING_SECTION_ORDER = 450

/**
 * User-facing options. `enabled` is the hot toggle; every field is volatile so
 * a write updates the live references without remounting this plugin.
 */
export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .volatile()
    .description('启用公文模式：回复以公文格式呈现，并附加正式公文文风约束'),
  salutation: Schema.string()
    .default('尊敬的领导：')
    .volatile()
    .description('公文称谓（正文之前的称呼行，留空则不显示）'),
  signature: Schema.string()
    .default('DeepSeek Harness')
    .volatile()
    .description('发文机关标志与署名的机关全称或规范化简称'),
  issueCode: Schema.string()
    .default('DSH')
    .volatile()
    .description('发文机关代字，用于自动生成的发文字号（如 DSH〔2026〕1号）'),
  issueNumber: Schema.string()
    .default('')
    .volatile()
    .description('发文字号；留空则按“机关代字〔年份〕序号号”自动生成'),
  autoSend: Schema.boolean()
    .default(true)
    .volatile()
    .description('圈阅识别成功后自动发送（仅当输入框草稿为空时）'),
  showHeader: Schema.boolean()
    .default(true)
    .volatile()
    .description('显示公文题头（红头与文号）'),
  showSignature: Schema.boolean()
    .default(true)
    .volatile()
    .description('显示公文落款（署名与日期）'),
  thinkingZh: Schema.boolean()
    .default(true)
    .volatile()
    .description('中文思考（合并自 dsh-zh-thinking）：思考过程使用简体中文并按【步骤 N｜阶段名】组织'),
  essayTone: Schema.boolean()
    .default(true)
    .volatile()
    .description('申论语气：按“提出问题—分析原因—提出对策—总结升华”的行文脉络组织回复'),
}).description('公文模式：公文体回复、正式文风、申论语气、中文思考与圈阅反馈')

const DEFAULTS = Object.freeze({
  enabled: true,
  salutation: '尊敬的领导：',
  signature: 'DeepSeek Harness',
  issueCode: 'DSH',
  issueNumber: '',
  autoSend: true,
  showHeader: true,
  showSignature: true,
  thinkingZh: true,
  essayTone: true,
})

/**
 * The formal-prose constraint. Deliberately mirrors the upstream
 * codex-document-mode wording: it shapes register and sentence devices, and it
 * explicitly refuses to rewrite facts, code, commands, logs, tables, or JSON.
 * @returns the system-prompt fragment for an enabled mode.
 */
export function renderStyleGuide(options = {}) {
  const essayTone = options.essayTone !== false
  const lines = [
    '【公文模式】本条约束仅调整表达方式，不改变任务、事实、立场、选材或结论。',
    '请以正式公文文风呈递回复：',
    '1. 采用准确、简明、克制的书面语言，按事项分条组织层次，避免口语、网络用语、感叹句与营销腔。',
    '2. 不寒暄、不自我评价、不铺垫情绪；先给结论与依据，再给必要的细节。',
    '3. 按文种选择收束语：请示以“妥否，请批示”征询意见；报告以“特此报告”陈述事项；',
    '   函以“特此函告”沟通事宜；通知以“特此通知”告知事项；批复以“此复”作答。',
    '4. 不得改写用户提供的事实、立场、选材、任务，也不得改写用户或仓库给定的输出格式。',
    '5. 代码块、命令、日志、表格、JSON、文件路径与链接保持原格式与原文，不受文风约束影响。',
  ]
  if (essayTone) {
    lines.push(
      '6. 行文取申论笔法，按“提出问题—分析原因—提出对策—总结升华”的脉络展开：',
      '   先摆明现状与问题，再剖析成因（主观与客观、制度与执行并重），',
      '   继而提出可操作的对策（分条列项、明确主体与举措），最后收束于意义与展望。',
      '7. 论述须有观点、有依据、有层次：多用“要……须……”“既……又……”“一方面……另一方面……”',
      '   等申论常用句式；坚持以理服人，避免空泛表态与口号堆砌。',
      '8. 上述行文脉络仅约束组织方式与措辞，不得据此增删事实、夸大结论或编造依据。',
    )
  }
  return lines.join('\n')
}

/**
 * 中文思考规范（合并自 dsh-zh-thinking）。
 *
 * 只约束内部思考过程，不改变最终回复的内容、语言、事实与格式；代码、命令、
 * 路径、API 名称与报错原文一律保留原样。空的返回串会被装配层丢弃。
 * @returns 思考规范片段。
 */
export function renderReasoningGuide() {
  let index = 0
  const n = () => `${++index}.`
  return [
    '【中文思考规范】本规范只约束你的内部思考过程（reasoning / thinking），不改变最终回复的内容、语言、事实与格式。',
    `${n()} 思考一律使用简体中文书面语；代码、命令、文件路径、API 名称、报错原文与专有名词保留原样，不作翻译。`,
    `${n()} 每行只表达一个意思，先判断、再依据、后下一步；避免大段罗列、重复与自我评价。`,
    `${n()} 按关键步骤组织思考：每进入一个新阶段，先单独一行写出步骤标记，格式为【步骤 N｜阶段名】；N 从 1 起单调递增，阶段名为 2 至 6 个汉字。`,
    '     步骤标记之后先用一句话写明本步目标，再用不超过 6 条短句写出本步的推理与动作。',
    `${n()} 工具调用、报错、方案变更等关键事件，在对应步骤内以行首标记注明：[调用]、[风险]、[修复]；没有则不写。`,
    `${n()} 思考结束时另起一行写【结论】，用一句话概括即将给出的答案；仍有未决问题时另起一行以【待定】列出。`,
    `${n()} 标记仅用于思考过程，不得出现在最终回复正文中；不得为了凑格式而重复、空转或编造步骤。`,
  ].join('\n')
}

/**
 * Read one schemastery `.volatile()` reference, tolerating a plain value.
 * @param reference - the volatile reference (or an already-plain value).
 * @param fallback - value used when the reference resolves to undefined.
 * @returns the current value.
 */
function readRef(reference, fallback) {
  try {
    if (reference !== null && typeof reference === 'object' && typeof reference.get === 'function') {
      const value = reference.get()
      return value === undefined ? fallback : value
    }
    return reference === undefined ? fallback : reference
  } catch {
    return fallback
  }
}

/**
 * Project a raw settings value onto the complete public option set.
 * @param config - the merged option value.
 * @returns the fully-defaulted public configuration.
 */
export function publicConfig(config = {}) {
  const value = config ?? {}
  return {
    enabled: value.enabled === undefined ? DEFAULTS.enabled : value.enabled === true,
    salutation: typeof value.salutation === 'string' ? value.salutation : DEFAULTS.salutation,
    signature: typeof value.signature === 'string' ? value.signature : DEFAULTS.signature,
    issueCode: typeof value.issueCode === 'string' ? value.issueCode : DEFAULTS.issueCode,
    issueNumber: typeof value.issueNumber === 'string' ? value.issueNumber : DEFAULTS.issueNumber,
    autoSend: value.autoSend !== false,
    showHeader: value.showHeader !== false,
    showSignature: value.showSignature !== false,
    thinkingZh: value.thinkingZh !== false,
    essayTone: value.essayTone !== false,
  }
}

const PATCHABLE = new Set(Object.keys(DEFAULTS))

/** Write a JSON response with no-store caching. */
function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Accept requests from this machine only. */
function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Reject cross-origin callers so a random page cannot flip the mode. */
function originAllowed(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** Parse and validate a JSON settings patch. */
async function readPatch(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 8192) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const value = JSON.parse(raw === '' ? '{}' : raw)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('patch must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!PATCHABLE.has(key)) throw new Error(`unknown setting: ${key}`)
  }
  return value
}

/**
 * Mount the plugin.
 * @param ctx - cordis context carrying `settings`, `systemPrompt`, `webServer`.
 * @param config - the bundle row's parsed `.volatile()` config references.
 */
function mount(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const settings = ctx.settings
  const entryId = ctx.fiber?.entry?.options?.id

  // Optimistic local overlay: a flip takes effect immediately even when the
  // write path is unavailable, and is dropped once the live refs catch up.
  const overrides = {}

  const read = () => publicConfig({
    enabled: readRef(config?.enabled, DEFAULTS.enabled),
    salutation: readRef(config?.salutation, DEFAULTS.salutation),
    signature: readRef(config?.signature, DEFAULTS.signature),
    issueCode: readRef(config?.issueCode, DEFAULTS.issueCode),
    issueNumber: readRef(config?.issueNumber, DEFAULTS.issueNumber),
    autoSend: readRef(config?.autoSend, DEFAULTS.autoSend),
    showHeader: readRef(config?.showHeader, DEFAULTS.showHeader),
    showSignature: readRef(config?.showSignature, DEFAULTS.showSignature),
    thinkingZh: readRef(config?.thinkingZh, DEFAULTS.thinkingZh),
    essayTone: readRef(config?.essayTone, DEFAULTS.essayTone),
    ...overrides,
  })

  const canPersist = settings !== undefined
    && typeof settings.update === 'function'
    && typeof entryId === 'string'
    && entryId !== ''

  // --- 1. System-prompt style section (dynamic, so the toggle is instant) ---
  const systemPrompt = ctx.systemPrompt
  if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    try {
      ctx.effect(
        () => systemPrompt.section({
          name: STYLE_SECTION_NAME,
          order: STYLE_SECTION_ORDER,
          text: () => {
            const value = read()
            return value.enabled ? renderStyleGuide({ essayTone: value.essayTone }) : ''
          },
        }),
        'dsh-document-mode: system prompt section',
      )
      // 思考规范（合并自 dsh-zh-thinking）：随公文模式一并启停。
      ctx.effect(
        () => systemPrompt.section({
          name: REASONING_SECTION_NAME,
          order: REASONING_SECTION_ORDER,
          interpolate: false,
          text: () => {
            const value = read()
            return value.enabled && value.thinkingZh ? renderReasoningGuide() : ''
          },
        }),
        'dsh-document-mode: reasoning-style section',
      )
    } catch (error) {
      logger.error?.('[dsh-document-mode] failed to register style section', error)
    }
  } else {
    logger.warn?.('[dsh-document-mode] systemPrompt service unavailable; prose style disabled')
  }

  // --- 2. Live state fan-out to every open browser tab ---
  const clients = new Set()
  let lastPayload = ''

  const broadcast = () => {
    if (clients.size === 0) return
    const payload = `data: ${JSON.stringify({ type: 'config', config: read() })}\n\n`
    // A persisted write reaches us twice (the Loader's volatile-update plus the
    // request handler); identical frames are dropped so tabs see one edge each.
    if (payload === lastPayload) return
    lastPayload = payload
    for (const res of clients) {
      try {
        res.write(payload)
      } catch {
        clients.delete(res)
      }
    }
  }

  // A volatile-only write commits into the running references and notifies the
  // owning fiber; drop the overlay and tell the browsers.
  try {
    ctx.on('loader/volatile-update', () => {
      for (const key of Object.keys(overrides)) delete overrides[key]
      broadcast()
    })
  } catch (error) {
    logger.warn?.('[dsh-document-mode] failed to observe volatile updates', error)
  }

  /**
   * Persist a patch. Falls back to the in-process overlay when the profile has
   * no writable settings surface, so the toggle still works for the session.
   * @param patch - validated option fields.
   * @returns whether the value was written to the profile.
   */
  const write = async (patch) => {
    Object.assign(overrides, patch)
    if (!canPersist) return false
    await settings.update(entryId, patch)
    for (const key of Object.keys(patch)) delete overrides[key]
    return true
  }

  // --- 3. HTTP endpoints ---
  const configHandler = async (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress) || !originAllowed(req)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      jsonResponse(res, 200, read())
      return
    }
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      const patch = await readPatch(req)
      if (Object.keys(patch).length > 0) {
        await write(patch)
        broadcast()
      }
      jsonResponse(res, 200, read())
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const eventsHandler = (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress) || !originAllowed(req)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write('retry: 3000\n\n')
    res.write(`data: ${JSON.stringify({ type: 'config', config: read() })}\n\n`)
    clients.add(res)
    const remove = () => clients.delete(res)
    req.on('close', remove)
    req.on('error', remove)
  }

  const webServer = ctx.webServer
  if (webServer !== undefined && typeof webServer.register === 'function') {
    try {
      ctx.effect(
        () => webServer.register({ kind: 'exact', path: CONFIG_ENDPOINT, handler: configHandler }),
        'dsh-document-mode: local config endpoint',
      )
      ctx.effect(
        () => webServer.register({ kind: 'exact', path: EVENTS_ENDPOINT, handler: eventsHandler }),
        'dsh-document-mode: local events endpoint',
      )
    } catch (error) {
      logger.error?.('[dsh-document-mode] failed to register HTTP endpoints', error)
    }
  } else if (typeof ctx.inject === 'function') {
    // Late-binding path, mirroring dsh-dafeiyu: a host that mounts the
    // webserver after this row still gets the endpoints.
    try {
      ctx.inject(['webServer'], (httpCtx) => {
        const late = httpCtx.webServer
        if (late === undefined || typeof late.register !== 'function') return
        try {
          httpCtx.effect(
            () => late.register({ kind: 'exact', path: CONFIG_ENDPOINT, handler: configHandler }),
            'dsh-document-mode: local config endpoint',
          )
          httpCtx.effect(
            () => late.register({ kind: 'exact', path: EVENTS_ENDPOINT, handler: eventsHandler }),
            'dsh-document-mode: local events endpoint',
          )
        } catch (error) {
          logger.error?.('[dsh-document-mode] failed to register HTTP endpoints', error)
        }
      })
    } catch (error) {
      logger.error?.('[dsh-document-mode] failed to inject webServer', error)
    }
  }

  // --- 4. Teardown ---
  ctx.effect(() => () => {
    for (const res of clients) {
      try {
        res.end()
      } catch {}
    }
    clients.clear()
  }, 'dsh-document-mode: teardown')

  logger.info?.(
    `[dsh-document-mode] mounted (enabled=${String(read().enabled)}, persist=${canPersist ? entryId : 'memory-only'})`,
  )
}

/**
 * Plugin entry.
 * @param ctx - cordis context.
 * @param config - the bundle row's parsed volatile config.
 */
export function apply(ctx, config = {}) {
  try {
    mount(ctx, config)
  } catch (error) {
    // DSH treats a throwing activation as fatal for the whole boot; this row is
    // cosmetic, so it degrades to inert instead of taking the app down.
    const logger = ctx?.logger ?? console
    logger.error?.('[dsh-document-mode] mount failed; plugin stays inert', error)
  }
}
