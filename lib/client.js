/**
 * dsh-document-mode — browser half.
 *
 * Loaded by the DSH Web shell through `window.__ModuleLoader__` like every
 * other client plugin (the module id must equal the npm package name).
 *
 *  1. Document-mode presentation. One scoped stylesheet plus a MutationObserver
 *     that derives a 公文 title from each assistant reply. No React tree is
 *     replaced: the mode is a root attribute plus a few attributes on chat
 *     rows, so toggling it is instant and fully reversible.
 *  2. The 圈阅 pad in the composer's left control row. Draw a circle to agree or
 *     a cross to disagree; a confident stroke writes `【反馈：同意】` /
 *     `【反馈：不同意】` into the draft.
 *  3. A composer toolbar toggle and a Settings → General row bound to the same
 *     live state.
 *  4. An SSE subscription so a toggle in one tab reaches every other tab
 *     without a refresh.
 *
 * Host half: `lib/index.js` (persisted volatile settings + prompt style section).
 */
window.__ModuleLoader__.load({
  id: 'dsh-document-mode',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React

    const CONFIG_ENDPOINT = '/plugins/dsh-document-mode/config'
    const EVENTS_ENDPOINT = '/plugins/dsh-document-mode/events'
    const ROOT_ATTR = 'data-dsh-doc-mode'
    const STYLE_TAG_ID = 'dsh-document-mode-style'
    const LOG = '[dsh-document-mode]'

    // ---------------------------------------------------------------------
    // Shared live state
    // ---------------------------------------------------------------------

    const DEFAULTS = Object.freeze({
      enabled: true,
      salutation: '尊敬的领导：',
      signature: 'DeepSeek Harness',
      issueCode: 'DSH',
      issueNumber: '',
      autoSend: true,
      showHeader: true,
      showSignature: true,
    })

    let state = { ...DEFAULTS }
    /** 会话标题，作为公文"事由"的次优来源，由输入栏组件回填。 */
    let sessionTitle = ''
    /** 圈阅栏是否展开；用户可关闭，状态记在 localStorage。 */
    let sealBarVisible = true
    try {
      const saved = window.localStorage?.getItem('dsh-document-mode:sealbar')
      if (saved === 'hidden') sealBarVisible = false
    } catch {}
    const listeners = new Set()

    function emit() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error) {
          console.error(LOG, 'listener failed', error)
        }
      }
    }

    function setState(patch, { silent = false } = {}) {
      state = { ...state, ...patch }
      if (!silent) emit()
    }

    /** 记录当前会话标题；变化时重新拟标题。 */
    function setSessionTitle(next) {
      const value = typeof next === 'string' ? next : ''
      if (value === sessionTitle) return
      sessionTitle = value
      scheduleDecorate()
    }

    /** 展开／收起圈阅栏，并把选择记入 localStorage。 */
    function setSealBarVisible(next) {
      if (sealBarVisible === next) return
      sealBarVisible = next
      try {
        window.localStorage?.setItem('dsh-document-mode:sealbar', next ? 'shown' : 'hidden')
      } catch {}
      emit()
    }

    /** React binding over the module-level state. */
    function useMode() {
      const [, force] = React.useReducer((n) => n + 1, 0)
      useEffect(() => {
        listeners.add(force)
        return () => { listeners.delete(force) }
      }, [])
      return state
    }

    // ---------------------------------------------------------------------
    // Host round-trip
    // ---------------------------------------------------------------------

    async function patchSettings(patch) {
      const response = await fetch(CONFIG_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    function commit(config) {
      setState(config)
      applyRoot()
      scheduleDecorate()
    }

    async function hydrate() {
      try {
        const response = await fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
        if (!response.ok) return
        commit(await response.json())
      } catch (error) {
        console.warn(LOG, 'config unavailable; keeping local defaults', error)
      }
    }

    /** Flip the hot toggle: optimistic locally, persisted on the host. */
    async function toggleMode(next) {
      const previous = state.enabled
      setState({ enabled: next })
      applyRoot()
      scheduleDecorate()
      try {
        commit(await patchSettings({ enabled: next }))
      } catch (error) {
        console.error(LOG, 'failed to persist the toggle', error)
        setState({ enabled: previous })
        applyRoot()
        scheduleDecorate()
      }
    }

    /** Persist one or more options from the settings row. */
    async function updateSettings(patch) {
      setState(patch)
      applyRoot()
      scheduleDecorate()
      try {
        commit(await patchSettings(patch))
      } catch (error) {
        console.error(LOG, 'failed to persist settings', error)
        void hydrate()
      }
    }

    function connectEvents() {
      if (typeof EventSource !== 'function') return () => {}
      let source
      let closed = false
      const open = () => {
        if (closed) return
        try {
          source = new EventSource(EVENTS_ENDPOINT)
        } catch {
          return
        }
        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload?.type === 'config' && payload.config) commit(payload.config)
          } catch {}
        }
        source.onerror = () => {
          try { source.close() } catch {}
          if (!closed) setTimeout(open, 4000)
        }
      }
      open()
      return () => {
        closed = true
        try { source?.close() } catch {}
      }
    }

    // ---------------------------------------------------------------------
    // Document-mode presentation
    // ---------------------------------------------------------------------

    function applyRoot() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (state.enabled) root.setAttribute(ROOT_ATTR, 'on')
      else root.setAttribute(ROOT_ATTR, 'off')
    }

    /**
     * 成文日期 uses Arabic numerals with the full year and no zero padding,
     * per GB/T 9704—2012 §7.3.5.2 ("用阿拉伯数字将年、月、日标全，年份应标
     * 全称，月、日不编虚位"). 汉字日期 is NOT standard and would be wrong here.
     */
    function formatDate(date = new Date()) {
      return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    }

    function organisation() {
      return (state.signature || DEFAULTS.signature).trim() || 'DeepSeek Harness'
    }

    /**
     * 发文字号 = 发文机关代字 + 〔年份〕 + 发文顺序号，年份用六角括号括入，
     * 序号不编虚位（GB/T 9704—2012 §7.3.2）。
     */
    /**
     * 发文字号 = 发文机关代字 + 〔年份〕 + 发文顺序号（§7.3.2）。
     *
     * 顺序号取该回复所在**会话轮次**（DOM 上的 `data-chat-turn`），因此每呈递一份
     * 公文依次递增为 1号、2号、3号……，且同一条回复重渲染时号码不变。用户显式
     * 配置 `issueNumber` 时以配置为准。
     */
    function buildIssueNumber(row) {
      const configured = (state.issueNumber || '').trim()
      if (configured) return configured
      const turn = Number(row?.getAttribute('data-chat-turn'))
      const serial = Number.isFinite(turn) && turn > 0 ? Math.floor(turn) : 1
      return `${state.issueCode || 'DSH'}〔${new Date().getFullYear()}〕${serial}号`
    }

    /**
     * 发文机关标志 = 发文机关全称或规范化简称（GB/T 9704—2012 §7.2.4）。
     * 发文字号是与它分开的要素，另由 buildIssueNumber() 提供。
     */
    function buildHeader() {
      return organisation()
    }

    /** 发文机关署名 + 成文日期（§7.3.5）。 */
    function buildSignature() {
      return `${organisation()}\n${formatDate()}`
    }

    /** 公文文种，用于标题收尾。 */
    /** 《党政机关公文处理工作条例》规定的法定文种中，对话回复可能用到的部分。 */
    const GENRES = ['报告', '请示', '通知', '函', '批复', '意见', '决定', '纪要', '通报', '议案', '复函', '公告', '通告']

    /**
     * 按回复内容推断文种（GB/T 9704—2012 §7.3.1：标题 = 发文机关 + 事由 + 文种）。
     *
     * 文种不是固定的"报告"：征询批准用"请示"，答复来文用"批复／复函"，告知事项用
     * "通知"，平级商洽用"函"。这里依据公文里约定俗成的收束语与措辞判定，判定不出
     * 时回落"报告"——"报告"用于陈述事项，是最通用的保守选择。
     *
     * @param text - 回复正文纯文本。
     * @returns 文种名（如"报告"）。
     */
    function detectGenre(text) {
      const body = text || ''
      // 请示：向上级请求指示、批准
      if (/妥否[，,]?\s*请批示|请予批复|请予批准|请审批|是否可行[，,]?\s*请|请示/.test(body)) return '请示'
      // 批复：答复下级的请示
      if (/此复|现批复如下|批复如下/.test(body)) return '批复'
      // 通报：表彰、批评、传达情况
      if (/特此通报|通报如下/.test(body)) return '通报'
      // 纪要：记载会议议定事项
      if (/会议纪要|纪要如下/.test(body)) return '纪要'
      // 意见：对重要问题提出见解和处理办法
      if (/提出如下意见|实施意见|指导意见/.test(body)) return '意见'
      // 通知：发布、传达要求下级执行的事项
      if (/特此通知|通知如下|请.{0,8}遵照执行|请.{0,8}贯彻执行/.test(body)) return '通知'
      // 函：不相隶属机关之间商洽、询问、答复
      if (/特此函告|函告如下|敬请函复|请予支持/.test(body)) return '函'
      // 报告：陈述事项、汇报工作、答复询问
      return '报告'
    }

    /** 是否形如层次序数（一、／（一）／1.／（1））——这类片段不能当"事由"。 */
    const LEVEL_HEADING_RE = /^[一二三四五六七八九十]+、|^（[一二三四五六七八九十]+）|^\d{1,2}[.、]|^（\d{1,2}）/

    /**
     * 拟"事由"（标题中"关于……的"那一段）。
     *
     * 按优先级取第一个"像事由"的候选：回复内的标题元素 → 会话标题 → 回复首句。
     * 层次序数式标题（如"一、交付内容"）不是事由，跳过它继续往下一档找，而不是
     * 直接回落到通用文种——否则只要有 h2 小标题就永远只剩"工作情况报告"。
     *
     * 取文本只用 `textContent`——`innerText` 会把 ::before/::after 生成的内容也
     * 算进去，那样红头、发文字号乃至上一轮写进去的标题都会串进来。
     * @param body - 正文容器（槽位锚点的第一个元素子节点）。
     */
    function deriveSubject(body) {
      const heading = body ? body.querySelector('h1, h2, h3, h4, h5, h6') : null
      if (heading) {
        const text = (heading.textContent || '').replace(/^#+\s*/, '').trim()
        if (text && !LEVEL_HEADING_RE.test(text)) return text
      }

      const sessionSubject = (sessionTitle || '').trim()
      if (sessionSubject && !LEVEL_HEADING_RE.test(sessionSubject)) return sessionSubject

      if (!body) return ''
      const raw = (body.textContent || '').replace(/\s+/g, ' ').trim()
      const cleaned = raw.replace(/^(收到|好的|好|明白|了解|已收到|以下是)[，。、：:\s]*/, '')
      const sentence = (cleaned.match(/^[^。！？；;]+/) || [''])[0].trim()
      if (!sentence || LEVEL_HEADING_RE.test(sentence)) return ''
      // 过长时退到第一个逗号分句，避免把半句话塞进标题
      if (sentence.length > 24) {
        const clause = (sentence.match(/^[^，,、]{6,24}/) || [''])[0]
        return clause.trim()
      }
      return sentence
    }

    /**
     * 组公文标题（GB/T 9704—2012 §7.3.1）：`关于{事由}的{文种}`。
     *
     * 文种由 detectGenre() 按内容推断，不再一律用"报告"。事由已以"关于"开头时只补
     * 文种；事由本身已以文种收尾时原样使用，避免"关于……的报告的报告"。
     */
    function composeTitle(body) {
      const subject = deriveSubject(body)
        .replace(/^[#\s]+/, '')
        .replace(/[。；;，,：:、\s]+$/, '')
        .trim()
      const genre = detectGenre(body ? body.textContent : '')

      if (!subject || LEVEL_HEADING_RE.test(subject)) return `工作情况${genre === '请示' ? '报告' : genre}`

      // 事由自身已带文种，直接采用
      const trailing = GENRES.find((name) => subject.endsWith(name))
      if (trailing) return subject

      if (/^关于/.test(subject)) return `${subject}的${genre}`
      return `关于${subject}的${genre}`
    }

    function setDocAttr(element, name, value) {
      if (!element) return
      const next = value === undefined || value === null ? '' : String(value)
      if (next === '') {
        if (element.hasAttribute(name)) element.removeAttribute(name)
        return
      }
      if (element.getAttribute(name) !== next) element.setAttribute(name, next)
    }

    const ROW_SELECTOR = '[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]'

    /**
     * 正文层次序数（GB/T 9704—2012 §7.3.3）：一级"一、"用黑体，二级"（一）"
     * 用楷体，三级"1."与四级"（1）"用仿宋。
     *
     * 只在整段确实是"标题行"时才套用层次字体——即序数之后不再出现句末标点。
     * 这样"一、总体要求"会变黑体，而"一、总体要求。坚持稳中求进……"这种
     * 序数与正文同段的写法仍保持仿宋，不会被整段涂成黑体。
     */
    const LEVEL_PATTERNS = [
      { level: 1, re: /^[一二三四五六七八九十]{1,3}、/ },
      { level: 2, re: /^（[一二三四五六七八九十]{1,3}）/ },
      { level: 3, re: /^\d{1,2}[.、]/ },
      { level: 4, re: /^（\d{1,2}）/ },
    ]

    function markLevels(body) {
      if (!body) return
      for (const element of body.querySelectorAll('p, li')) {
        const text = (element.textContent || '').trim()
        const matched = LEVEL_PATTERNS.find(({ re }) => re.test(text))
        let level = 0
        if (matched) {
          const rest = text.replace(matched.re, '')
          if (!/[。！？；;]/.test(rest)) level = matched.level
        }
        setDocAttr(element, 'data-doc-level', level ? String(level) : '')
      }
    }

    /** 清掉一行的全部公文装饰（用于把纸从"过程节点"上撤走）。 */
    function clearDecoration(row) {
      if (!row) return
      for (const name of ['data-doc-paper', 'data-doc-head', 'data-doc-sign', 'data-doc-head-on', 'data-doc-sign-on']) {
        if (row.hasAttribute(name)) row.removeAttribute(name)
      }
      const node = row.querySelector('[data-slot="conversation.chat.node"]')
      const body = node ? node.firstElementChild : null
      for (const element of [node, body]) {
        if (!element) continue
        for (const name of ['data-doc-issue', 'data-doc-issue-on', 'data-doc-title', 'data-doc-salutation', 'data-doc-title-on']) {
          if (element.hasAttribute(name)) element.removeAttribute(name)
        }
      }
    }

    function decorateRow(row) {
      const node = row.querySelector('[data-slot="conversation.chat.node"]')
      // 标题/主送机关的伪元素挂在正文容器（槽位锚点的第一个元素子节点）上，
      // 这样标题(小标宋)与主送机关(仿宋)才能各用各的字体。
      const body = node ? node.firstElementChild : null

      const title = composeTitle(body)
      const salutation = (state.salutation || '').trim()
      const head = state.showHeader ? buildHeader() : ''
      const issue = state.showHeader ? buildIssueNumber(row) : ''
      const sign = state.showSignature ? buildSignature() : ''

      // 公文纸的总闸：只有带这个属性的行才会被套版面（见 CSS 的 ROW 常量）。
      setDocAttr(row, 'data-doc-paper', '1')

      // 红头在行伪元素上，落款也在行伪元素上。
      setDocAttr(row, 'data-doc-head', head)
      setDocAttr(row, 'data-doc-sign', sign)
      setDocAttr(row, 'data-doc-head-on', head ? '1' : '')
      setDocAttr(row, 'data-doc-sign-on', sign ? '1' : '')

      // 发文字号 + 红色分隔线是槽位锚点的 ::before，属性必须写在锚点本身，
      // 否则 attr() 取不到值、门控选择器也不匹配。
      setDocAttr(node, 'data-doc-issue', node ? issue : '')
      setDocAttr(node, 'data-doc-issue-on', node && issue ? '1' : '')

      setDocAttr(body, 'data-doc-title', body ? title : '')
      setDocAttr(body, 'data-doc-salutation', body ? salutation : '')
      setDocAttr(body, 'data-doc-title-on', body && (title || salutation) ? '1' : '')
      markLevels(body)
    }

    /**
     * 只给「每轮最后一个节点」套公文纸。
     *
     * 思考链里的每个分步也是 `[data-chat-flow-kind="assistant-step"]`（官方用
     * `kind === 'assistant-step' && step === answerStep` 判定最终答复），若按 kind
     * 直接套版面，每个思考步骤都会变成一整张红头白纸——即"大量无用白块"。
     *
     * 故按 `data-chat-turn` 分组，只保留每轮 DOM 顺序里的最后一个节点作为最终答复，
     * 同一轮的其余过程节点一律清掉装饰。这样每轮至多一张公文纸，且落在答复上。
     */
    function decorateAll() {
      if (typeof document === 'undefined') return
      const rows = [...document.querySelectorAll(ROW_SELECTOR)]

      if (!state.enabled) {
        for (const row of rows) clearDecoration(row)
        return
      }

      const byTurn = new Map()
      for (const row of rows) {
        // 折叠状态下被隐藏的过程节点无需处理
        if (row.hasAttribute('data-turn-process-hidden')) {
          clearDecoration(row)
          continue
        }
        // 无轮次标记时归入同一桶，仍保证只给最后一个套纸
        const turn = row.getAttribute('data-chat-turn') ?? 'unknown'
        const bucket = byTurn.get(turn)
        if (bucket) bucket.push(row)
        else byTurn.set(turn, [row])
      }

      for (const bucket of byTurn.values()) {
        const answer = bucket[bucket.length - 1]
        for (const row of bucket) {
          if (row === answer) continue
          try {
            clearDecoration(row)
          } catch (error) {
            console.error(LOG, 'failed to clear decoration', error)
          }
        }
        try {
          decorateRow(answer)
        } catch (error) {
          console.error(LOG, 'decoration failed for one row', error)
        }
      }
    }

    let decorateHandle
    function scheduleDecorate() {
      if (typeof window === 'undefined' || decorateHandle !== undefined) return
      decorateHandle = window.setTimeout(() => {
        decorateHandle = undefined
        decorateAll()
      }, 120)
    }

    function startObservers() {
      if (typeof document === 'undefined') return () => {}
      let observer
      try {
        observer = new MutationObserver(() => scheduleDecorate())
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      } catch (error) {
        console.warn(LOG, 'MutationObserver unavailable', error)
      }
      // Safety net for re-renders the observer may coalesce away.
      const sweep = window.setInterval(() => {
        if (state.enabled) scheduleDecorate()
      }, 1500)
      return () => {
        try { observer?.disconnect() } catch {}
        window.clearInterval(sweep)
      }
    }

    // ---------------------------------------------------------------------
    // Stylesheet
    // ---------------------------------------------------------------------

    const SCOPE = `html[${ROOT_ATTR}="on"]`
    /*
     * 公文纸只挂在"每轮最终答复"的那一行上（由 decorateAll 打 data-doc-paper）。
     * 把门控写进 ROW 常量，下面所有版面规则都自动继承这道闸——否则思考链里每个
     * assistant-step 分步都会被套上整张红头白纸。
     */
    const ROW = ':is([data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"])[data-doc-paper="1"]'
    const NODE = '[data-slot="conversation.chat.node"]'

    const CSS = `
/*
 * 版面依据 GB/T 9704—2012《党政机关公文格式》。
 *
 * 基准：正文 3 号仿宋（16pt），故 1em = 16pt = 5.6444mm。下列 em 值均由标准
 * 毫米值换算，页面整体随 --dsh-doc-scale 等比缩放：
 *   幅面 A4 210×297mm；版心 156×225mm；上白边 37mm、左白边 28mm
 *   （右 26mm、下 35mm 由幅面减版心推得）；每面 22 行、每行 28 字；
 *   行距 = 225mm ÷ 22 ≈ 29pt ≈ 1.812em（标准未规定固定磅值，此为推导值）。
 */
${SCOPE} {
  /*
   * 字体栈：标准公文字体名排在最前。
   *
   * 本机已装入真正的公文四体（仿宋、仿宋_GB2312、黑体、楷体、楷体_GB2312）与
   * 方正小标宋简体，故直接使用标准族名即可命中。此前曾用开源替代字体（朱雀仿宋、
   * 霞鹜文楷）是因缺字体的权宜之计，现已移除。
   *
   * 注意：这些标准名在**未安装**对应字体时会被 fontconfig 悄悄替换成
   * Noto Sans CJK SC（黑体）。若换到没装公文字体的机器上，请先用 fc-match 仿宋
   * 确认命中，否则正文会显示成黑体。
   */
  --dsh-doc-xiaobiaosong: "方正小标宋简体", "方正小标宋_GBK", "FZXiaoBiaoSong-B05S", "STZhongsong", "华文中宋", "SimSun", serif;
  --dsh-doc-fangsong: "仿宋", "仿宋_GB2312", "FangSong", "FangSong_GB2312", "方正仿宋_GBK", "方正仿宋简体", serif;
  --dsh-doc-heiti: "黑体", "SimHei", "方正黑体简体", "方正黑体_GBK", "Noto Sans CJK SC", sans-serif;
  --dsh-doc-kaiti: "楷体", "楷体_GB2312", "KaiTi", "KaiTi_GB2312", "方正楷体简体", "方正楷体_GBK", serif;
  /* 标准第 6.2 条规定红色油墨应达色谱 Y80%、M80%，屏幕取近似正红 */
  --dsh-doc-red: #e60012;
  --dsh-doc-scale: 1;
}

@media (max-width: 900px) { ${SCOPE} { --dsh-doc-scale: 0.82; } }
@media (max-width: 720px) { ${SCOPE} { --dsh-doc-scale: 0.68; } }

/* ---- A4 公文页：width = 版心 156mm + 左 28mm + 右 26mm = 210mm ---- */
${SCOPE} ${ROW} {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(37.2em, 100%);
  margin: 14px auto 18px;
  /*
   * 左右各 27mm → 版心恒为 37.2em − 9.568em = 27.632em ≈ 156mm（标准值）。
   * 上下留白按"对话中每页都要读"的场景收敛：标准的上白边 37mm 与版头区
   * 35mm 是为印刷红头文件的份号／密级预留的，叠加后每页顶部会出现约 72mm
   * 的空白；本渲染省略这些要素，故只留必要的纸边。
   */
  padding: 1.8em 4.784em 3.4em 4.784em;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  /* 标准第 5.2.4 条：公文中文字的颜色均为黑色 */
  color: #000;
  font-family: var(--dsh-doc-fangsong);
  font-size: calc(16pt * var(--dsh-doc-scale));
  line-height: 1.812;
  text-align: justify;
  text-justify: inter-ideograph;

  /*
   * 公文纸恒为"白纸黑字"，因此在此子树内就地重声明 DSH 内容 token。
   *
   * 官方 markdown 组件（MarkdownText / CodeBlock）取色一律走
   * --dsw-alias-label-* 与 --dsw-alias-markdown-*，而主题与皮肤会在暗色下把
   * 它们改成浅色文字与深色半透明底。若不在公文页内覆盖，浅色字会落在白纸上
   * 近乎不可见，深色半透明底会变成灰块——即"白字 + 半透明轮廓"的成因。
   */
  --dsw-alias-label-primary: #000;
  --dsw-alias-label-primary-dimmed: #1a1a1a;
  --dsw-alias-label-secondary: #333;
  --dsw-alias-label-tertiary: #444;
  --dsw-alias-label-caption: #555;
  --dsw-alias-label-dimmed: #666;
  --dsw-alias-label-primary-inverted: #fff;
  --dsw-alias-label-primary-foreground: #fff;
  --dsw-alias-markdown-code-block: #f4f4f4;
  --dsw-alias-markdown-code-block-banner: #ececec;
  --dsw-alias-markdown-inline-code: #f0f0f0;
  --dsw-alias-markdown-tag: #f0f0f0;
  --dsw-alias-markdown-citation: #eeeeee;
  --dsw-alias-markdown-placeholder: #f0f0f0;
  --dsw-alias-markdown-code-segment-selected: #ffffff;
  --dsw-alias-markdown-code-segment-unselected: #f0f0f0;
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.14);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.18);
  --dsw-alias-border-l3: rgba(0, 0, 0, 0.24);
  --dsw-alias-border-l4: rgba(0, 0, 0, 0.3);
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #fafafa;
  --dsw-alias-bg-layer-3: #f5f5f5;
  --dsw-alias-bg-overlay: #ffffff;
  --dsw-alias-bg-multi-select: #e8e8e8;
  --dsw-alias-bg-mask-1: transparent;
  --dsw-alias-bg-mask-2: transparent;
  --dsw-alias-bg-mask-3: transparent;
  --dsw-alias-state-error-primary: #b3271e;
  --dsw-alias-state-success-primary: #1f7a3d;
  --dsw-alias-state-warn-primary: #8a6d1f;
  --dsw-specific-bubble: #f5f5f5;
  --dsw-specific-bubble-highlight: #ececec;
}

/*
 * 再兜一层：任何主题/插件用 text-shadow 或渐变文字在公文页内制造的"轮廓"与
 * 描边一律中和；-webkit-text-fill-color 归位到元素自身颜色，避免出现"颜色
 * 设了却不显色"的假象。
 */
${SCOPE} ${ROW} *,
${SCOPE} ${ROW} *::before,
${SCOPE} ${ROW} *::after {
  -webkit-text-fill-color: currentColor;
  text-shadow: none;
}

/*
 * 白纸黑字强制归位。
 *
 * 主题、皮肤与外观类插件会在正文块上留下**运行时生成**的底色（静态样式表里检索
 * 不到）、浅色字与阴影，令牌覆盖也压不住。公文纸必须是白纸黑字（GB/T 9704—2012
 * §5.2.4），故在此子树内用 !important 统一压平：正文块一律无底色、黑字、无阴影；
 * 代码块与行内代码再单独恢复浅灰底，保持可读。
 */
${SCOPE} ${ROW} :is(p, li, ul, ol, dl, dt, dd, blockquote, h1, h2, h3, h4, h5, h6, table, thead, tbody, tr, td, th, span, strong, em, b, i, small, div, section, article) {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  backdrop-filter: none !important;
}

${SCOPE} ${ROW} :is(p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, span, strong, em, b, i, small) {
  color: #000 !important;
  -webkit-text-fill-color: #000 !important;
}

/* 代码块与行内代码：恢复浅灰底、黑字 */
${SCOPE} ${ROW} pre,
${SCOPE} ${ROW} div:has(> pre) {
  background-color: #f4f4f4 !important;
  border-radius: 4px !important;
}

${SCOPE} ${ROW} pre code {
  background-color: transparent !important;
}

${SCOPE} ${ROW} :not(pre) > code {
  background-color: #f0f0f0 !important;
  color: #000 !important;
  -webkit-text-fill-color: #000 !important;
}

/* 发文机关标志（红头）：红色小标宋，居中 */
${SCOPE} ${ROW}[data-doc-head-on="1"]::before {
  content: attr(data-doc-head);
  order: 1;
  display: block;
  /*
   * 标准 §7.2.4 为"上边缘至版心上边缘 35mm"，该空间是给份号、密级和保密期限、
   * 紧急程度三行预留的。这三项在对话场景不适用且未渲染，若照搬会在每页顶部
   * 留下大片空白，故收敛为空一行。
   */
  margin-top: 1.812em;
  text-align: center;
  color: var(--dsh-doc-red);
  font-family: var(--dsh-doc-xiaobiaosong);
  /* 标准未规定字号，由发文机关按"醒目、美观、庄重"自定；此处取一号 */
  font-size: 1.625em;
  line-height: 1.4;
  letter-spacing: 0.04em;
  text-align-last: center;
}

/* 槽位锚点原为 display:contents；改为真实容器才能承载伪元素 */
${SCOPE} ${ROW} ${NODE} {
  display: flex !important;
  flex-direction: column;
  order: 2;
  min-width: 0;
}

/* 发文字号（3 号仿宋，居中）+ 红色分隔线（发文字号下 4mm，与版心等宽） */
${SCOPE} ${ROW} ${NODE}[data-doc-issue-on="1"]::before {
  content: attr(data-doc-issue);
  order: 1;
  display: block;
  margin-top: 3.624em;
  padding-bottom: 0.7087em;
  text-align: center;
  font-family: var(--dsh-doc-fangsong);
  font-size: 1em;
  color: #000;
  border-bottom: 2px solid var(--dsh-doc-red);
}

/*
 * 正文容器：Assistant markdown 根节点。改为纵向弹性盒，才能用 order 让
 * ::before(标题) 与 ::after(主送机关) 都排在正文之前——::after 按 DOM 顺序
 * 本在正文之后，靠 order 提前。
 */
${SCOPE} ${ROW} ${NODE} > * {
  display: flex;
  flex-direction: column;
  order: 2;
  min-width: 0;
}

/* 标题：2 号小标宋，红色分隔线下空二行，居中 */
${SCOPE} ${ROW} ${NODE} > *[data-doc-title-on="1"]::before {
  content: attr(data-doc-title);
  order: 1;
  display: block;
  margin-top: 3.624em;
  text-align: center;
  font-family: var(--dsh-doc-xiaobiaosong);
  font-size: 1.375em;
  line-height: 1.7;
  font-weight: 400;
  text-align-last: center;
}

/* 主送机关：标题下空一行，3 号仿宋，居左顶格，末尾全角冒号 */
${SCOPE} ${ROW} ${NODE} > *[data-doc-title-on="1"]::after {
  content: attr(data-doc-salutation);
  order: 2;
  display: block;
  margin-top: 1.812em;
  text-align: left;
  text-align-last: left;
  font-family: var(--dsh-doc-fangsong);
  font-size: 1em;
}

${SCOPE} ${ROW} ${NODE} > * > * {
  order: 3;
}

/* 正文：3 号仿宋，每自然段左空二字，回行顶格 */
${SCOPE} ${ROW} p {
  margin: 0;
  text-indent: 2em;
  text-align: justify;
}

${SCOPE} ${ROW} li p {
  text-indent: 0;
}

/* 层次序数：一级黑体、二级楷体、三/四级仿宋 */
${SCOPE} ${ROW} h1,
${SCOPE} ${ROW} h2 {
  margin: 0;
  font-family: var(--dsh-doc-heiti);
  font-size: 1em;
  font-weight: 400;
  text-indent: 2em;
}

${SCOPE} ${ROW} h3 {
  margin: 0;
  font-family: var(--dsh-doc-kaiti);
  font-size: 1em;
  font-weight: 400;
  text-indent: 2em;
}

/*
 * 三级（1.）、四级（（1））层次序数：GB/T 9704—2012 §7.3.3 规定用仿宋体字，
 * 且未要求加粗——早期此处误加了 700，会与"加粗即标题"的观感混淆，现归为常规字重。
 */
${SCOPE} ${ROW} h4,
${SCOPE} ${ROW} h5,
${SCOPE} ${ROW} h6 {
  margin: 0;
  font-family: var(--dsh-doc-fangsong);
  font-size: 1em;
  font-weight: 400;
  text-indent: 2em;
}

/* 段首层次序数：行内"一、""（一）""1.""（1）"按层级套字体（§7.3.3） */
${SCOPE} ${ROW} [data-doc-level="1"] {
  font-family: var(--dsh-doc-heiti);
  font-weight: 400;
}

${SCOPE} ${ROW} [data-doc-level="2"] {
  font-family: var(--dsh-doc-kaiti);
  font-weight: 400;
}

${SCOPE} ${ROW} [data-doc-level="3"],
${SCOPE} ${ROW} [data-doc-level="4"] {
  font-family: var(--dsh-doc-fangsong);
  font-weight: 400;
}

/* 发文机关署名 + 成文日期：3 号仿宋，右对齐，右空四字 */
${SCOPE} ${ROW}[data-doc-sign-on="1"]::after {
  content: attr(data-doc-sign);
  order: 3;
  display: block;
  white-space: pre-line;
  margin-top: 1.812em;
  padding-right: 4em;
  text-align: right;
  text-align-last: right;
  font-family: var(--dsh-doc-fangsong);
  font-size: 1em;
  line-height: 1.812;
  color: #000;
}

/*
 * 页码、份号、密级、紧急程度、签发人、附件说明、附注、版记等要素在无分页
 * 的对话流中不适用，故未实现。
 */

/* 代码、命令、日志、表格保持原格式 */
${SCOPE} ${ROW} pre,
${SCOPE} ${ROW} code,
${SCOPE} ${ROW} kbd,
${SCOPE} ${ROW} samp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.82em;
  line-height: 1.55;
  text-indent: 0;
  text-align-last: left;
}

${SCOPE} ${ROW} table {
  font-family: var(--dsh-doc-songti, inherit);
  font-size: 0.9em;
  line-height: 1.6;
  text-indent: 0;
}

/* ---- composer controls ---- */
.dsh-doc-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}

.dsh-doc-control:hover {
  color: var(--dsw-alias-label-primary, #1f1f1f);
  border-color: var(--dsh-doc-red, #b3271e);
}

.dsh-doc-control[data-on="1"] {
  color: #fff;
  border-color: var(--dsh-doc-red, #b3271e);
  background: var(--dsh-doc-red, #b3271e);
}

/* ---- 圈阅栏（全宽输入栏，大幅画板） ---- */
.dsh-doc-sealbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.3));
  border-radius: 10px;
  box-sizing: border-box;
}

.dsh-doc-sealbar-label {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--dsw-alias-label-primary, #1f1f1f);
}

.dsh-doc-sealpad {
  position: relative;
  flex: none;
  display: block;
  width: 240px;
  height: 80px;
  padding: 0;
  border: 1.5px dashed var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.5));
  border-radius: 8px;
  background-color: transparent;
  background-image:
    linear-gradient(to right, rgba(127, 127, 127, 0.09) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(127, 127, 127, 0.09) 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: crosshair;
  touch-action: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.dsh-doc-sealpad:hover {
  border-color: var(--dsh-doc-red, #b3271e);
}

.dsh-doc-sealpad[data-verdict="agree"] {
  border-color: #1f9254;
  border-style: solid;
  box-shadow: 0 0 0 3px rgba(31, 146, 84, 0.16);
}

.dsh-doc-sealpad[data-verdict="disagree"] {
  border-color: var(--dsh-doc-red, #b3271e);
  border-style: solid;
  box-shadow: 0 0 0 3px rgba(179, 39, 30, 0.16);
}

.dsh-doc-sealpad canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 6px;
  touch-action: none;
}

.dsh-doc-sealbar-hint {
  flex: 1 1 160px;
  min-width: 140px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
}

.dsh-doc-sealbar-verdict {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.dsh-doc-sealbar-verdict[data-kind="agree"] { color: #1f9254; }
.dsh-doc-sealbar-verdict[data-kind="disagree"] { color: var(--dsh-doc-red, #b3271e); }

.dsh-doc-sealbar-clear {
  flex: none;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.dsh-doc-sealbar-clear:hover {
  color: var(--dsw-alias-label-primary, #1f1f1f);
}

/* 关闭按钮：收起整条圈阅栏，工具栏「圈阅」按钮可重新展开 */
.dsh-doc-sealbar-close {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.dsh-doc-sealbar-close:hover {
  border-color: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
  color: var(--dsh-doc-red, #e60012);
}

.dsh-doc-control:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ---- settings card ---- */
.dsh-doc-card {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.3));
  border-radius: 12px;
}

.dsh-doc-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.dsh-doc-card-title {
  font-weight: 600;
}

.dsh-doc-card-hint {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  opacity: 0.65;
}

.dsh-doc-field {
  display: grid;
  grid-template-columns: 96px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.dsh-doc-field input[type="text"] {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.dsh-doc-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
`

    /** Inject the scoped stylesheet and return the disposer the fiber owns. */
    function installStyle() {
      if (typeof document === 'undefined') return () => {}
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`
      const existing = document.querySelector(selector)
      if (existing) existing.remove()
      const style = document.createElement('style')
      // The module system claims and removes tags carrying data-plugin; without
      // it a plugin reload would leak one stylesheet per HMR cycle.
      style.dataset.plugin = 'dsh-document-mode'
      style.dataset.pluginCss = STYLE_TAG_ID
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        try { style.remove() } catch {}
      }
    }

    // ---------------------------------------------------------------------
    // 圈阅 — stroke recognition
    // ---------------------------------------------------------------------

    /**
     * Classify one freehand stroke drawn around/before the pad centre.
     *
     * 圈 (agree): the stroke orbits the centroid without approaching it, stays
     * roughly equidistant, and sweeps most of the circle.
     * 叉 (disagree): the stroke repeatedly passes through the centre, so the
     * minimum radius collapses while the maximum stays large.
     *
     * @param points - sampled stroke points in canvas pixels.
     * @returns the verdict, or null when the stroke is not confident enough.
     */
    function classifyStroke(points) {
      if (!Array.isArray(points) || points.length < 8) return null

      let cx = 0
      let cy = 0
      for (const point of points) {
        cx += point.x
        cy += point.y
      }
      cx /= points.length
      cy /= points.length

      const radii = []
      let minRadius = Infinity
      let maxRadius = 0
      for (const point of points) {
        const radius = Math.hypot(point.x - cx, point.y - cy)
        radii.push(radius)
        if (radius < minRadius) minRadius = radius
        if (radius > maxRadius) maxRadius = radius
      }
      if (maxRadius < 8) return null

      const angles = points
        .map((point) => Math.atan2(point.y - cy, point.x - cx))
        .sort((a, b) => a - b)

      let maxGap = 0
      for (let i = 0; i < angles.length; i += 1) {
        const current = angles[i]
        const next = i + 1 === angles.length ? angles[0] + Math.PI * 2 : angles[i + 1]
        maxGap = Math.max(maxGap, next - current)
      }
      const coverage = Math.PI * 2 - maxGap

      const first = points[0]
      const last = points[points.length - 1]
      const closed = Math.hypot(first.x - last.x, first.y - last.y) / maxRadius < 0.75

      const ratio = minRadius / maxRadius

      let centreHits = 0
      let inside = false
      for (const radius of radii) {
        const near = radius < maxRadius * 0.34
        if (near && !inside) centreHits += 1
        inside = near
      }

      if (ratio > 0.42 && coverage > 4.2 && (closed || coverage > 5.2)) return 'agree'
      if (ratio < 0.5 && centreHits >= 2) return 'disagree'
      if (coverage > 4.7 && ratio > 0.36) return 'agree'
      if (centreHits >= 2) return 'disagree'
      return null
    }

    function useDraft(props) {
      const useInput = props?.useInput
      const draft = typeof useInput === 'function'
        ? useInput((snapshot) => (snapshot ? snapshot.draft ?? '' : ''))
        : ''
      return typeof draft === 'string' ? draft : ''
    }

    /**
     * 圈阅 — a full-width lane above the composer card carrying a large drawing
     * pad. 圈 (a closed orbit) means 同意, 叉 (a stroke through the centre) means
     * 不同意. Falls back to the clipboard when the input API is absent, and
     * renders nothing at all while 公文模式 is off.
     */
    function SealBar(props) {
      const canvasRef = useRef(null)
      const pointsRef = useRef([])
      const drawingRef = useRef(false)
      const [verdict, setVerdict] = useState('')
      const [note, setNote] = useState('')
      const mode = useMode()
      const hooked = useDraft(props)
      const draft = hooked || (typeof props?.input?.draft === 'string' ? props.input.draft : '')
      const draftRef = useRef(draft)
      draftRef.current = draft
      const actionsRef = useRef(props?.inputActions)
      actionsRef.current = props?.inputActions
      const autoSendRef = useRef(mode.autoSend)
      autoSendRef.current = mode.autoSend

      // 回填会话标题，供公文标题拟"事由"。
      const sessionTitleProp = props?.session?.title
      useEffect(() => {
        if (typeof sessionTitleProp === 'string') setSessionTitle(sessionTitleProp)
      }, [sessionTitleProp])

      const clear = useCallback(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }, [])

      const flash = useCallback((next) => {
        setVerdict(next)
        window.setTimeout(() => setVerdict((current) => (current === next ? '' : current)), 1600)
      }, [])

      const commit = useCallback((next) => {
        const text = next === 'agree' ? '【反馈：同意】' : '【反馈：不同意】'
        const actions = actionsRef.current
        if (!actions || typeof actions.setDraft !== 'function') {
          try { navigator.clipboard?.writeText(text) } catch {}
          setNote(`已复制到剪贴板：${text}`)
          flash(next)
          return
        }
        const current = draftRef.current ?? ''
        if (!current.trim()) {
          actions.setDraft(text)
          if (autoSendRef.current && typeof actions.submit === 'function') {
            window.setTimeout(() => {
              try { actions.submit() } catch {}
            }, 30)
            setNote(`已写入并发送：${text}`)
          } else {
            setNote(`已写入输入框：${text}`)
          }
        } else {
          actions.setDraft(`${current.replace(/\s+$/, '')}\n${text}`)
          setNote(`已追加到草稿：${text}`)
        }
        flash(next)
      }, [flash])

      const pointFrom = useCallback((event) => {
        const canvas = canvasRef.current
        const rect = canvas.getBoundingClientRect()
        return {
          x: (event.clientX - rect.left) * (canvas.width / rect.width),
          y: (event.clientY - rect.top) * (canvas.height / rect.height),
        }
      }, [])

      const onPointerDown = useCallback((event) => {
        if (event.button !== undefined && event.button !== 0) return
        const canvas = canvasRef.current
        if (!canvas) return
        event.preventDefault()
        try { canvas.setPointerCapture(event.pointerId) } catch {}
        drawingRef.current = true
        pointsRef.current = [pointFrom(event)]
        clear()
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.strokeStyle = '#b3271e'
          ctx.lineWidth = 2.6
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          ctx.moveTo(pointsRef.current[0].x, pointsRef.current[0].y)
        }
      }, [clear, pointFrom])

      const onPointerMove = useCallback((event) => {
        if (!drawingRef.current) return
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        const point = pointFrom(event)
        const points = pointsRef.current
        const previous = points[points.length - 1]
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.9) return
        points.push(point)
        ctx.lineTo(point.x, point.y)
        ctx.stroke()
      }, [pointFrom])

      const finish = useCallback(() => {
        if (!drawingRef.current) return
        drawingRef.current = false
        const result = classifyStroke(pointsRef.current)
        pointsRef.current = []
        if (result) {
          commit(result)
        } else {
          setNote('笔画太小或形状不明确，本次未写入。请画一个完整的圈或叉。')
          window.setTimeout(clear, 300)
        }
      }, [clear, commit])

      const reset = useCallback(() => {
        clear()
        setVerdict('')
        setNote('')
        pointsRef.current = []
      }, [clear])

      if (!mode.enabled || !sealBarVisible) return null

      return React.createElement('div', { className: 'dsh-doc-sealbar' },
        React.createElement('span', { className: 'dsh-doc-sealbar-label' }, '圈阅'),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-doc-sealpad',
          'data-verdict': verdict,
          title: '按住拖动：画圈＝同意，画叉＝不同意',
          'aria-label': '圈阅画板：画圈表示同意，画叉表示不同意',
          onPointerDown,
          onPointerMove,
          onPointerUp: finish,
          onPointerLeave: finish,
          onPointerCancel: finish,
        }, React.createElement('canvas', { ref: canvasRef, width: 480, height: 160 })),
        React.createElement('span', { className: 'dsh-doc-sealbar-hint' },
          note || '按住拖动即可圈阅：画一个完整的圈表示同意，画叉表示不同意。识别成功后写入输入框。'),
        verdict
          ? React.createElement('span', {
            className: 'dsh-doc-sealbar-verdict',
            'data-kind': verdict,
          }, verdict === 'agree' ? '已圈阅：同意' : '已圈阅：不同意')
          : null,
        React.createElement('button', {
          type: 'button',
          className: 'dsh-doc-sealbar-clear',
          onClick: reset,
        }, '清除'),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-doc-sealbar-close',
          title: '关闭圈阅栏（可用工具栏「圈阅」按钮重新展开）',
          'aria-label': '关闭圈阅栏',
          'data-doc-sealbar-close': '1',
          onClick: () => setSealBarVisible(false),
        }, '×'),
      )
    }

    /** 工具栏上的圈阅开关，用于重新展开被关闭的圈阅栏。 */
    function SealToggleButton() {
      const mode = useMode()
      const visible = sealBarVisible
      const disabled = !mode.enabled
      const title = disabled
        ? '公文模式关闭时不可圈阅'
        : visible ? '收起圈阅栏' : '展开圈阅栏'
      return React.createElement('button', {
        type: 'button',
        className: 'dsh-doc-control',
        'data-on': visible && !disabled ? '1' : '0',
        'data-doc-seal-toggle': visible ? 'on' : 'off',
        disabled,
        title,
        'aria-pressed': visible,
        onClick: () => setSealBarVisible(!visible),
      }, '圈阅')
    }

    // ---------------------------------------------------------------------
    // Toggle controls
    // ---------------------------------------------------------------------

    function DocModeButton() {
      const mode = useMode()
      const on = mode.enabled
      const title = on ? '公文模式：已启用（点击热禁用）' : '公文模式：已禁用（点击热启用）'
      return React.createElement('button', {
        type: 'button',
        className: 'dsh-doc-control',
        'data-on': on ? '1' : '0',
        'data-doc-mode-toggle': on ? 'on' : 'off',
        title,
        'aria-pressed': on,
        onClick: () => { void toggleMode(!on) },
      }, '公文')
    }

    function DocModeSettingsRow() {
      const mode = useMode()
      const on = mode.enabled

      const textField = (key, label, placeholder) => React.createElement('div', {
        className: 'dsh-doc-field',
        key,
      },
      React.createElement('span', null, label),
      React.createElement('input', {
        type: 'text',
        value: mode[key] ?? '',
        placeholder,
        onChange: (event) => { void updateSettings({ [key]: event.target.value }) },
      }))

      const checkBox = (key, label) => React.createElement('label', {
        className: 'dsh-doc-switch',
        key,
      },
      React.createElement('input', {
        type: 'checkbox',
        checked: mode[key] !== false,
        onChange: (event) => { void updateSettings({ [key]: event.target.checked }) },
      }),
      label)

      return React.createElement('div', { className: 'dsh-doc-card' },
        React.createElement('div', { className: 'dsh-doc-card-head' },
          React.createElement('div', null,
            React.createElement('div', { className: 'dsh-doc-card-title' }, '公文模式'),
            React.createElement('small', { className: 'dsh-doc-card-hint' },
              '回复以公文格式呈递并采用正式文风；圈阅可快速表达同意与否。开关即时生效，无需重启。'),
          ),
          React.createElement('label', { className: 'dsh-doc-switch' },
            React.createElement('input', {
              type: 'checkbox',
              checked: on,
              'data-doc-mode-settings-toggle': on ? 'on' : 'off',
              onChange: (event) => { void toggleMode(event.target.checked) },
            }),
            on ? '已启用' : '已禁用',
          ),
        ),
        textField('signature', '发文机关', '发文机关标志／署名的机关名称'),
        textField('salutation', '主送机关', '末尾用全角冒号，例如：尊敬的领导：'),
        textField('issueCode', '机关代字', '用于自动生成发文字号，例如：DSH'),
        textField('issueNumber', '发文字号', '留空则自动生成「代字〔年份〕1号」'),
        React.createElement('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap' } },
          checkBox('autoSend', '圈阅后自动发送'),
          checkBox('showHeader', '显示题头'),
          checkBox('showSignature', '显示落款'),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // DOCX 导出（纯前端，无第三方依赖，无需重启主机）
    //
    // 生成的是一份真正的 Office Open XML（.docx）：A4 幅面、GB/T 9704—2012 的
    // 页边距与字号、红头、发文字号、红色分隔线、标题、主送机关、正文、落款。
    // 导出件直接使用**标准公文字体名**（仿宋_GB2312、方正小标宋简体、黑体、
    // 楷体_GB2312），因此在装有公文字体的 Word/WPS 上即为标准字形——这一点比
    // 浏览器里用 OFL 替代字体更贴近标准。
    // ---------------------------------------------------------------------

    /** Office Open XML 里使用的公文字体名。 */
    /**
     * Office Open XML 里使用的公文字体名。
     *
     * 直接写标准公文字体名：本机已安装 仿宋、黑体、楷体、方正小标宋简体，导出件
     * 在本地 Word / LibreOffice 打开即为标准字形；这几个名字在中文版 Windows 与
     * WPS 上同样存在，跨机器打开也能正确显示。
     */
    const DOCX_FONT = {
      fangsong: '仿宋',
      xiaobiaosong: '方正小标宋简体',
      heiti: '黑体',
      kaiti: '楷体',
      mono: 'Consolas',
    }

    /** 半磅值：三号 16pt → 32，二号 22pt → 44，四号 14pt → 28。 */
    const DOCX_SIZE = { sanhao: 32, erhao: 44, sihao: 28 }
    /** 固定行距 29pt = 580（二十分之一磅），由 225mm÷22 行推得。 */
    const DOCX_LINE = 580

    function xmlEscape(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    const CRC_TABLE = (() => {
      const table = new Uint32Array(256)
      for (let i = 0; i < 256; i += 1) {
        let c = i
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
        table[i] = c >>> 0
      }
      return table
    })()

    function crc32(bytes) {
      let crc = 0xFFFFFFFF
      for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)
      return (crc ^ 0xFFFFFFFF) >>> 0
    }

    /** 生成 ZIP 容器（STORE 不压缩，兼容所有浏览器，Word 可正常打开）。 */
    function buildZip(entries) {
      const encoder = new TextEncoder()
      const body = []
      const central = []
      let offset = 0

      for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name)
        const data = entry.data
        const crc = crc32(data)
        const size = data.length

        const local = new Uint8Array(30 + nameBytes.length)
        const lv = new DataView(local.buffer)
        lv.setUint32(0, 0x04034B50, true)
        lv.setUint16(4, 20, true)
        lv.setUint16(6, 0x0800, true)
        lv.setUint16(8, 0, true)
        lv.setUint16(10, 0, true)
        lv.setUint16(12, 0x0021, true)
        lv.setUint32(14, crc, true)
        lv.setUint32(18, size, true)
        lv.setUint32(22, size, true)
        lv.setUint16(26, nameBytes.length, true)
        lv.setUint16(28, 0, true)
        local.set(nameBytes, 30)

        const cd = new Uint8Array(46 + nameBytes.length)
        const cv = new DataView(cd.buffer)
        cv.setUint32(0, 0x02014B50, true)
        cv.setUint16(4, 20, true)
        cv.setUint16(6, 20, true)
        cv.setUint16(8, 0x0800, true)
        cv.setUint16(10, 0, true)
        cv.setUint16(12, 0, true)
        cv.setUint16(14, 0x0021, true)
        cv.setUint32(16, crc, true)
        cv.setUint32(20, size, true)
        cv.setUint32(24, size, true)
        cv.setUint16(28, nameBytes.length, true)
        cv.setUint16(30, 0, true)
        cv.setUint16(32, 0, true)
        cv.setUint16(34, 0, true)
        cv.setUint16(36, 0, true)
        cv.setUint32(38, 0, true)
        cv.setUint32(42, offset, true)
        cd.set(nameBytes, 46)

        body.push(local, data)
        central.push(cd)
        offset += local.length + size
      }

      const centralSize = central.reduce((sum, cd) => sum + cd.length, 0)
      const eocd = new Uint8Array(22)
      const ev = new DataView(eocd.buffer)
      ev.setUint32(0, 0x06054B50, true)
      ev.setUint32(12, centralSize, true)
      ev.setUint32(16, offset, true)
      ev.setUint16(8, central.length, true)
      ev.setUint16(10, central.length, true)

      const all = [...body, ...central, eocd]
      const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
      let at = 0
      for (const part of all) {
        out.set(part, at)
        at += part.length
      }
      return out
    }

    /**
     * 生成一个 Word 段落。
     * @param parts - 字符串或 {text, bold?, italic?, font?, size?} 数组。
     * @param options - 对齐、字体、字号、缩进、行距、边框等。
     */
    function docxParagraph(parts, options = {}) {
      const {
        align = 'both',
        font = DOCX_FONT.fangsong,
        size = DOCX_SIZE.sanhao,
        color,
        bold = false,
        firstLineChars = 0,
        rightChars = 0,
        before = 0,
        after = 0,
        line = DOCX_LINE,
        border,
      } = options

      const ind = []
      if (firstLineChars) ind.push(`w:firstLineChars="${firstLineChars}"`)
      if (rightChars) ind.push(`w:rightChars="${rightChars}"`)

      const pPr = [
        `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="exact"/>`,
        `<w:jc w:val="${align}"/>`,
        ind.length ? `<w:ind ${ind.join(' ')}/>` : '',
        border ? `<w:pBdr><w:bottom w:val="single" w:sz="${border.sz}" w:space="1" w:color="${border.color}"/></w:pBdr>` : '',
        `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`,
      ].filter(Boolean).join('')

      const runs = (parts || []).map((rawPart) => {
        const part = typeof rawPart === 'string' ? { text: rawPart } : (rawPart || {})
        const text = part.text ?? ''
        if (text === '') return ''
        const runFont = part.font || font
        const runSize = part.size || size
        const runColor = part.color || color
        const rPr = [
          `<w:rFonts w:ascii="${runFont}" w:hAnsi="${runFont}" w:eastAsia="${runFont}"/>`,
          (part.bold ?? bold) ? '<w:b/>' : '',
          part.italic ? '<w:i/>' : '',
          runColor ? `<w:color w:val="${runColor}"/>` : '',
          `<w:sz w:val="${runSize}"/><w:szCs w:val="${runSize}"/>`,
        ].filter(Boolean).join('')
        const chunks = String(text).split('\n')
        const inner = chunks
          .map((chunk) => `<w:t xml:space="preserve">${xmlEscape(chunk)}</w:t>`)
          .join('<w:br/>')
        return `<w:r><w:rPr>${rPr}</w:rPr>${inner}</w:r>`
      }).join('')

      return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`
    }

    /** 取一个块元素的行内文字片段（保留加粗/斜体/代码）。 */
    function inlineParts(element, prefix = '') {
      const parts = []
      if (prefix) parts.push({ text: prefix })
      const walk = (node, style) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) {
            const text = child.nodeValue || ''
            if (text) parts.push({ ...style, text })
          } else if (child.nodeType === 1) {
            const tag = child.tagName
            if (tag === 'BR') {
              parts.push({ text: '\n' })
              continue
            }
            const next = { ...style }
            if (tag === 'STRONG' || tag === 'B') next.bold = true
            if (tag === 'EM' || tag === 'I') next.italic = true
            if (tag === 'CODE') {
              next.font = DOCX_FONT.mono
              next.size = DOCX_SIZE.sihao
            }
            walk(child, next)
          }
        }
      }
      walk(element, {})
      return parts.length ? parts : [{ text: element.textContent || '' }]
    }

    /** 表格 → Word 表格（细边框）。 */
    function docxTable(table) {
      const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`
      const cellBorders = ['top', 'left', 'bottom', 'right'].map(border).join('')
      const rowXml = [...table.querySelectorAll('tr')].map((tr) => {
        const cells = [...tr.children].map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcBorders>${cellBorders}</w:tcBorders></w:tcPr>${docxParagraph([(cell.textContent || '').trim()], {
          size: DOCX_SIZE.sihao,
          line: 360,
          align: 'left',
        })}</w:tc>`).join('')
        return `<w:tr>${cells}</w:tr>`
      }).join('')
      const tblBorders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${tblBorders}</w:tblBorders></w:tblPr>${rowXml}</w:tbl>`
    }

    /** 把一个正文块元素追加到文档块列表。 */
    function appendDocxBlock(blocks, element) {
      const tag = element.tagName
      if (!tag) return
      if (tag === 'UL' || tag === 'OL') {
        let index = 1
        for (const li of element.children) {
          if (li.tagName !== 'LI') continue
          const marker = tag === 'OL' ? `${index++}. ` : '· '
          blocks.push(docxParagraph(inlineParts(li, marker), { firstLineChars: 200 }))
        }
        return
      }
      if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
        const font = tag === 'H3' ? DOCX_FONT.kaiti : DOCX_FONT.heiti
        blocks.push(docxParagraph(inlineParts(element), { font, firstLineChars: 200 }))
        return
      }
      if (/^H[4-6]$/.test(tag)) {
        // §7.3.3：三级、四级层次序数用仿宋体字，不加粗
        blocks.push(docxParagraph(inlineParts(element), { firstLineChars: 200 }))
        return
      }
      if (tag === 'PRE') {
        for (const lineText of (element.textContent || '').split('\n')) {
          blocks.push(docxParagraph([lineText], { font: DOCX_FONT.mono, size: DOCX_SIZE.sihao, align: 'left', line: 320 }))
        }
        return
      }
      if (tag === 'TABLE') {
        blocks.push(docxTable(element))
        return
      }
      if (tag === 'P' || tag === 'BLOCKQUOTE') {
        blocks.push(docxParagraph(inlineParts(element), { firstLineChars: 200 }))
        return
      }
      for (const child of element.children) appendDocxBlock(blocks, child)
    }

    /** 按 GB/T 9704—2012 组装整篇文档的块序列。 */
    function buildDocxBlocks(row) {
      const node = row.querySelector('[data-slot="conversation.chat.node"]')
      const body = node ? node.firstElementChild : null
      const blocks = []
      const blank = (size = DOCX_SIZE.sanhao) => docxParagraph([''], { align: 'center', size })

      // 版头区（收敛为空二行，理由同网页版）
      blocks.push(blank(), blank())
      blocks.push(docxParagraph([organisation()], {
        align: 'center',
        size: 52,
        font: DOCX_FONT.xiaobiaosong,
        color: 'E60012',
      }))
      // 空二行 → 发文字号
      blocks.push(blank(), blank())
      blocks.push(docxParagraph([buildIssueNumber(row)], { align: 'center' }))
      // 红色分隔线（与版心等宽）
      blocks.push(docxParagraph([''], { align: 'center', border: { sz: 12, color: 'E60012' } }))
      // 空二行 → 标题
      blocks.push(blank(), blank())
      blocks.push(docxParagraph([composeTitle(body)], {
        align: 'center',
        size: DOCX_SIZE.erhao,
        font: DOCX_FONT.xiaobiaosong,
      }))
      // 空一行 → 主送机关
      blocks.push(docxParagraph(['']))
      const salutation = (state.salutation || '').trim()
      if (salutation) blocks.push(docxParagraph([salutation], { align: 'left' }))

      // 正文
      if (body) for (const child of body.children) appendDocxBlock(blocks, child)

      // 落款：空一行 → 发文机关署名 → 成文日期（右空四字）
      if (state.showSignature) {
        blocks.push(docxParagraph(['']))
        blocks.push(docxParagraph([organisation()], { align: 'right', rightChars: 400 }))
        blocks.push(docxParagraph([formatDate()], { align: 'right', rightChars: 400 }))
      }
      return blocks
    }

    const DOCX_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '</Types>'

    const DOCX_ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>'

    const DOCX_DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'

    const DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:docDefaults><w:rPrDefault><w:rPr>'
      + `<w:rFonts w:ascii="${DOCX_FONT.fangsong}" w:hAnsi="${DOCX_FONT.fangsong}" w:eastAsia="${DOCX_FONT.fangsong}"/>`
      + `<w:sz w:val="${DOCX_SIZE.sanhao}"/><w:szCs w:val="${DOCX_SIZE.sanhao}"/>`
      + '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
      + `<w:spacing w:line="${DOCX_LINE}" w:lineRule="exact"/><w:jc w:val="both"/>`
      + '</w:pPr></w:pPrDefault></w:docDefaults></w:styles>'

    /** 组装完整 .docx 字节。 */
    function buildDocxBytes(row) {
      const encoder = new TextEncoder()
      const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + buildDocxBlocks(row).join('')
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        // A4；上 37mm、右 26mm、下 35mm、左 28mm（1mm ≈ 56.69 twips）
        + '<w:pgMar w:top="2098" w:right="1474" w:bottom="1984" w:left="1587" w:header="851" w:footer="992" w:gutter="0"/>'
        + '<w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="580"/>'
        + '</w:sectPr></w:body></w:document>'
      return buildZip([
        { name: '[Content_Types].xml', data: encoder.encode(DOCX_CONTENT_TYPES) },
        { name: '_rels/.rels', data: encoder.encode(DOCX_ROOT_RELS) },
        { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOCX_DOC_RELS) },
        { name: 'word/styles.xml', data: encoder.encode(DOCX_STYLES) },
        { name: 'word/document.xml', data: encoder.encode(documentXml) },
      ])
    }

    /** 文件名里不能出现的字符。 */
    function safeFileName(value) {
      return String(value).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || '公文'
    }

    /**
     * 导出最近一份公文为 .docx。
     * @returns 导出的文件名，没有可导出的公文时返回空串。
     */
    function exportLatestDocument() {
      if (typeof document === 'undefined') return ''
      const rows = document.querySelectorAll(ROW_SELECTOR)
      const row = rows[rows.length - 1]
      if (!row) return ''
      const node = row.querySelector('[data-slot="conversation.chat.node"]')
      const body = node ? node.firstElementChild : null
      const bytes = buildDocxBytes(row)
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const fileName = `${safeFileName(composeTitle(body))}-${formatDate().replace(/[年月]/g, '-').replace('日', '')}.docx`
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => {
        try { URL.revokeObjectURL(url) } catch {}
      }, 4000)
      return fileName
    }

    /** 工具栏上的「导出」按钮：导出最近一份公文。 */
    function ExportButton() {
      const mode = useMode()
      const [hint, setHint] = useState('')
      const disabled = !mode.enabled
      const title = disabled ? '公文模式关闭时无可导出内容' : '将最近一份公文导出为 .docx 文件'
      return React.createElement('button', {
        type: 'button',
        className: 'dsh-doc-control',
        'data-doc-export': '1',
        disabled,
        title: hint || title,
        'aria-label': title,
        onClick: () => {
          try {
            const name = exportLatestDocument()
            setHint(name ? `已导出 ${name}` : '未找到可导出的公文')
          } catch (error) {
            console.error(LOG, 'docx export failed', error)
            setHint('导出失败，请查看控制台')
          }
          window.setTimeout(() => setHint(''), 2600)
        },
      }, hint ? '已导出' : '导出')
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function registerSafely(ctx, slotName, options, Component, label) {
      try {
        ctx.slots.inject(slotName, () => {
          try {
            ctx.slots.register(options, Component)
          } catch (error) {
            console.error(`${LOG} failed to register ${label}`, error)
          }
        })
      } catch (error) {
        console.error(`${LOG} failed to inject into ${slotName}`, error)
      }
    }

    function apply(ctx) {
      if (typeof ctx.effect === 'function') ctx.effect(installStyle, 'dsh-document-mode: client styles')
      else installStyle()
      applyRoot()
      void hydrate()
      if (typeof ctx.effect === 'function') ctx.effect(startObservers, 'dsh-document-mode: chat observer')
      else startObservers()

      registerSafely(ctx, 'conversation.input.left', {
        name: 'conversation.input.left',
        id: 'dsh-document-mode-toggle',
        order: 40,
        label: '公文模式',
        inject: () => ({}),
      }, DocModeButton, 'composer toggle')

      // 圈阅栏可被用户关闭，故在工具栏留一个开关用于重新展开。
      registerSafely(ctx, 'conversation.input.left', {
        name: 'conversation.input.left',
        id: 'dsh-document-mode-seal-toggle',
        order: 41,
        label: '圈阅',
        inject: () => ({}),
      }, SealToggleButton, '圈阅 toggle')

      // 导出最近一份公文为 .docx（纯前端生成，无需主机参与）。
      registerSafely(ctx, 'conversation.input.left', {
        name: 'conversation.input.left',
        id: 'dsh-document-mode-export',
        order: 42,
        label: '导出 DOCX',
        inject: () => ({}),
      }, ExportButton, '导出按钮')

      // 圈阅 lives in the full-width input lane above the composer card, which
      // is the only seat wide enough for a pad you can actually draw on.
      // `input` (the InputZone owner share) and the session standard kit's
      // `useInput`/`inputActions` all arrive as props, so no inject face is
      // needed.
      registerSafely(ctx, 'conversation.input.dock', {
        name: 'conversation.input.dock',
        id: 'dsh-document-mode-seal',
        order: 42,
        label: '圈阅',
        inject: () => ({}),
      }, SealBar, '圈阅 lane')

      registerSafely(ctx, 'settings.general.item', {
        name: 'settings.general.item',
        id: 'dsh-document-mode',
        order: 900,
        label: '公文模式',
        inject: () => ({}),
      }, DocModeSettingsRow, 'settings row')

      if (typeof ctx.effect === 'function') ctx.effect(connectEvents, 'dsh-document-mode: state events')
      else connectEvents()
    }

    module.exports = {
      name: 'dsh-document-mode-client',
      inject: ['slots'],
      apply,
    }
    // 测试钩子：供 test/docx.mjs 在无浏览器环境下验证 .docx 生成逻辑。
    module.exports.__test = {
      buildZip,
      crc32,
      docxParagraph,
      buildDocxBytes,
      buildDocxBlocks,
      safeFileName,
      exportLatestDocument,
      composeTitle,
      buildIssueNumber,
    }
    return module.exports
  },
})
