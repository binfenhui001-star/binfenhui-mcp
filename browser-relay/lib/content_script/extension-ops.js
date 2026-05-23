/**
 * Extension.* virtual CDP commands.
 *
 * These commands are NOT part of the Chrome Debugger Protocol —
 * they use chrome.scripting.executeScript to inject page-level scripts
 * and chrome.tabs / chrome.debugger for viewport/zoom/screenshot operations.
 *
 * This avoids the need for a persistent content script while providing
 * capabilities similar to Manus (content extraction, element marking, etc).
 */

import { unwrapScriptResult } from './helpers.js'
import { extWaitForReady } from './wait-ready.js'

// ── Viewport & Zoom ──

function wrapDebuggerCommand(tabId, fn) {
  return fn().catch((err) => {
    const msg = err?.message || String(err)
    if (msg.includes('attach') || msg.includes('debugger') || msg.includes('Another debugger')) {
      throw new Error(`Tab ${tabId} is not attached to debugger. Ensure ensureAttached was called first. Original: ${msg}`)
    }
    throw err
  })
}

export async function extGetViewportInfo(tabId) {
  const debuggee = { tabId }
  const result = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      zoom: window.innerWidth > 0 ? Math.round(window.outerWidth / window.innerWidth * 100) / 100 : 1,
    })`,
    returnByValue: true,
  }))
  return JSON.parse(result?.result?.value || '{}')
}

export async function extEnsureZoom(tabId, params) {
  const targetZoom = typeof params?.zoom === 'number' ? params.zoom : 1
  const currentZoom = await chrome.tabs.getZoom(tabId)
  if (Math.abs(currentZoom - targetZoom) > 0.01) {
    await chrome.tabs.setZoom(tabId, targetZoom)
    await new Promise((r) => setTimeout(r, 150))
    return { changed: true, from: currentZoom, to: targetZoom }
  }
  return { changed: false, current: currentZoom }
}

// ── Screenshot ──

export async function extCaptureViewport(tabId, params) {
  const debuggee = { tabId }
  const format = params?.format || 'png'
  const quality = params?.quality || 80

  await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
    awaitPromise: true,
  })).catch(() => {})

  const metrics = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Page.getLayoutMetrics'))
  const vv = metrics?.visualViewport || {}

  const vpResult = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: 'JSON.stringify({ dpr: window.devicePixelRatio || 1 })',
    returnByValue: true,
  }))
  const { dpr } = JSON.parse(vpResult?.result?.value || '{"dpr":1}')

  const screenshot = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
    format,
    quality: format === 'jpeg' ? quality : undefined,
    clip: {
      x: vv.pageX || 0,
      y: vv.pageY || 0,
      width: vv.clientWidth || 1280,
      height: vv.clientHeight || 720,
      scale: 1 / dpr,
    },
    captureBeyondViewport: false,
  }))

  return {
    data: screenshot?.data,
    width: Math.round(vv.clientWidth || 1280),
    height: Math.round(vv.clientHeight || 720),
    dpr,
  }
}

// ── Content Extraction ──

export async function extExtractContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const title = document.title
        || document.querySelector('meta[property="og:title"]')?.content
        || document.querySelector('h1')?.textContent?.trim() || ''

      const main = document.querySelector('main, article, [role="main"], #content, .content')
      const root = main || document.body

      function toMarkdown(el) {
        const lines = []
        const walk = (node) => {
          if (node.nodeType === 3) {
            const t = node.textContent.replace(/\s+/g, ' ').trim()
            if (t) lines.push(t)
            return
          }
          if (node.nodeType !== 1) return
          const tag = node.tagName
          try {
            const style = getComputedStyle(node)
            if (style.display === 'none' || style.visibility === 'hidden') return
          } catch { /* skip check */ }

          if (/^H[1-6]$/.test(tag)) {
            lines.push('\n' + '#'.repeat(+tag[1]) + ' ' + node.textContent.trim())
          } else if (tag === 'P') {
            lines.push('\n' + node.innerText.replace(/\s+/g, ' ').trim())
          } else if (tag === 'LI') {
            lines.push('- ' + node.innerText.replace(/\s+/g, ' ').trim())
          } else if (tag === 'A' && node.href) {
            lines.push(`[${node.textContent.trim()}](${node.href})`)
          } else if (tag === 'IMG' && node.alt) {
            lines.push(`![${node.alt}](${node.src})`)
          } else if (tag === 'PRE' || tag === 'CODE') {
            lines.push('\n```\n' + node.textContent.trim() + '\n```')
          } else if (tag === 'BR') {
            lines.push('\n')
          } else if (tag === 'TABLE') {
            lines.push('\n' + node.innerText.replace(/\t/g, ' | ').trim())
          } else {
            for (const child of node.childNodes) walk(child)
            if (node.shadowRoot) {
              for (const child of node.shadowRoot.childNodes) walk(child)
            }
          }
        }
        walk(el)
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      }

      return {
        title: title.trim(),
        url: location.href,
        content: toMarkdown(root).slice(0, 50000),
      }
    },
  })
  return unwrapScriptResult(results, 'Extension.extractContent')
}

// ── Interactive Element Marking ──

export async function extMarkElements(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (options) => {
      const INTERACTIVE_SELECTOR = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
        '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
      ].join(',')

      const SKIP_TAGS = new Set([
        'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK',
      ])

      function deepElementFromPoint(x, y) {
        const el = document.elementFromPoint(x, y)
        if (el?.shadowRoot) {
          const inner = el.shadowRoot.elementFromPoint(x, y)
          if (inner && inner !== el) return inner
        }
        return el
      }

      function isDescendantOrSelf(node, target) {
        let cur = node
        while (cur) {
          if (cur === target) return true
          if (cur.parentElement) { cur = cur.parentElement; continue }
          const root = cur.getRootNode()
          cur = root instanceof ShadowRoot ? root.host : null
        }
        return false
      }

      function isVisible(el, rect, vw, vh) {
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return false
        const clipped = {
          left: Math.max(rect.left, 0), top: Math.max(rect.top, 0),
          right: Math.min(rect.right, vw), bottom: Math.min(rect.bottom, vh),
        }
        const cw = clipped.right - clipped.left
        const ch = clipped.bottom - clipped.top
        if (cw < 3 || ch < 3) return false

        const cols = Math.min(4, Math.max(1, Math.round(cw / 20)))
        const rows = Math.min(4, Math.max(1, Math.round(ch / 20)))
        let hits = 0, total = 0
        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            const px = clipped.left + (cols > 0 ? (c / cols) * cw : cw / 2)
            const py = clipped.top + (rows > 0 ? (r / rows) * ch : ch / 2)
            const top = deepElementFromPoint(px, py)
            if (top && isDescendantOrSelf(top, el)) hits++
            total++
          }
        }
        return total > 0 && (hits / total) >= 0.3
      }

      function collectInteractive(root, out) {
        for (const el of root.querySelectorAll('*')) {
          if (SKIP_TAGS.has(el.tagName)) continue
          if (el.matches(INTERACTIVE_SELECTOR)) out.push(el)
          if (el.shadowRoot) collectInteractive(el.shadowRoot, out)
        }
      }

      const vw = window.innerWidth || 1, vh = window.innerHeight || 1
      const candidates = []
      collectInteractive(document, candidates)

      const elements = []
      let idx = 1
      const maxElements = options?.maxElements || 200

      for (const el of candidates) {
        if (idx > maxElements) break
        const rect = el.getBoundingClientRect()
        if (rect.width < 5 || rect.height < 5) continue

        try {
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
        } catch { /* skip check */ }

        if (!isVisible(el, rect, vw, vh)) continue

        const tag = el.tagName.toLowerCase()
        const text = (el.textContent || el.value || el.placeholder
          || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 100)

        el.setAttribute('data-accio-idx', String(idx))

        elements.push({
          idx, tag,
          type: el.type || '',
          text,
          role: el.getAttribute('role') || '',
          rect: {
            x: Math.round(rect.left), y: Math.round(rect.top),
            w: Math.round(rect.width), h: Math.round(rect.height),
          },
          center: {
            nx: +(((rect.left + rect.width / 2) / vw).toFixed(4)),
            ny: +(((rect.top + rect.height / 2) / vh).toFixed(4)),
          },
        })
        idx++
      }

      return {
        elements,
        viewport: { width: vw, height: vh, dpr: window.devicePixelRatio || 1 },
        url: location.href,
        title: document.title,
      }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.markElements')
}

// ── DOM Actions ──

export async function extClick(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => {
      function deepQuery(root, sel) {
        const found = root.querySelector(sel)
        if (found) return found
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const inner = deepQuery(el.shadowRoot, sel)
            if (inner) return inner
          }
        }
        return null
      }
      let el
      if (p.index != null) {
        const idx = Number(p.index)
        if (!Number.isInteger(idx) || idx <= 0) return { success: false, error: 'Invalid index' }
        el = deepQuery(document, `[data-accio-idx="${idx}"]`)
      } else if (p.selector) {
        try { el = deepQuery(document, p.selector) } catch { return { success: false, error: 'Invalid selector' } }
      } else if (p.x != null && p.y != null) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const cx = p.viewportWidth ? (p.x / p.viewportWidth) * vw : p.x
        const cy = p.viewportHeight ? (p.y / p.viewportHeight) * vh : p.y
        el = document.elementFromPoint(cx, cy)
        if (el?.shadowRoot) {
          const inner = el.shadowRoot.elementFromPoint(cx, cy)
          if (inner) el = inner
        }
      }
      if (!el) return { success: false, error: 'Element not found' }
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2

      const clickType = (p.clickType || 'single_left').toLowerCase()
      const isRight = clickType.includes('right')
      const button = isRight ? 2 : 0
      const baseOpts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button }

      if (clickType === 'double_left') {
        el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: 2 }))
        el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: 2 }))
        el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: 2 }))
        el.dispatchEvent(new MouseEvent('dblclick', { ...baseOpts, detail: 2 }))
      } else if (clickType === 'triple_left') {
        for (let i = 1; i <= 3; i++) {
          el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: i }))
          el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: i }))
          el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: i }))
        }
      } else if (isRight) {
        el.dispatchEvent(new MouseEvent('mousedown', baseOpts))
        el.dispatchEvent(new MouseEvent('mouseup', baseOpts))
        el.dispatchEvent(new MouseEvent('contextmenu', baseOpts))
      } else {
        el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: 1 }))
      }

      return { success: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 80), clickType, _cx: cx, _cy: cy }
    },
    args: [params || {}],
  })
  const result = unwrapScriptResult(results, 'Extension.click')
  if (result?.success && result._cx != null) {
    showClickRipple(tabId, result._cx, result._cy).catch(() => {})
    delete result._cx
    delete result._cy
  }
  return result
}

async function showClickRipple(tabId, x, y) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cx, cy) => {
      if (!document.getElementById('accio-ripple-style')) {
        const s = document.createElement('style')
        s.id = 'accio-ripple-style'
        s.textContent = '@keyframes accio-r{0%{transform:scale(0);opacity:1}100%{transform:scale(2.5);opacity:0}}'
        document.head.appendChild(s)
      }
      const d = document.createElement('div')
      Object.assign(d.style, {
        position: 'fixed', left: `${cx - 16}px`, top: `${cy - 16}px`,
        width: '32px', height: '32px', borderRadius: '50%',
        background: 'rgba(99,102,241,0.4)', pointerEvents: 'none',
        zIndex: '2147483647', animation: 'accio-r .8s ease-out forwards',
      })
      document.body.appendChild(d)
      d.onanimationend = () => d.remove()
    },
    args: [x, y],
  })
}

export async function extInput(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => {
      function deepQuery(root, sel) {
        const found = root.querySelector(sel)
        if (found) return found
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const inner = deepQuery(el.shadowRoot, sel)
            if (inner) return inner
          }
        }
        return null
      }
      let el
      if (p.index != null) {
        const idx = Number(p.index)
        if (!Number.isInteger(idx) || idx <= 0) return { success: false, error: 'Invalid index' }
        el = deepQuery(document, `[data-accio-idx="${idx}"]`)
      } else if (p.selector) {
        try { el = deepQuery(document, p.selector) } catch { return { success: false, error: 'Invalid selector' } }
      }
      if (!el) return { success: false, error: 'Element not found' }

      el.focus()
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const proto = tag === 'SELECT' ? HTMLSelectElement.prototype
          : tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (nativeSet) nativeSet.call(el, p.text || '')
        else el.value = p.text || ''
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (el.getAttribute('contenteditable') === 'true') {
        el.focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, p.text || '')
      }
      return { success: true }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.input')
}

// ── Playwright-style virtual commands (data-accio-ref="eN") ──

function normalizeNavigateUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) throw new Error('Extension.browserNavigate: url is required')
  if (/^(https?:\/\/|about:|chrome-extension:|file:\/\/)/i.test(url)) return url
  return `https://${url}`
}

/** Navigate the attached tab to a URL (Playwright-style; Claude Chrome parity). */
export async function extBrowserNavigate(tabId, params) {
  const rawUrl =
    typeof params?.url === 'string'
      ? params.url
      : typeof params?.href === 'string'
        ? params.href
        : ''
  const url = normalizeNavigateUrl(rawUrl)

  await chrome.tabs.update(tabId, { url })

  const waitReady = params?.waitReady !== false
  let ready = null
  if (waitReady) {
    const timeout =
      typeof params?.timeout === 'number' && params.timeout > 0 ? params.timeout : 30_000
    ready = await extWaitForReady(tabId, { timeout })
  }

  const tab = await chrome.tabs.get(tabId)
  return {
    success: true,
    tabId,
    url: tab.url || url,
    title: tab.title || '',
    ready,
  }
}

/** @param {import('../cdp/tabs/manager.js').TabManager} mgr */
export async function extBrowserInfo(tabId, mgr) {
  const tab = await chrome.tabs.get(tabId)
  const attachedTabs = []
  for (const [id, entry] of mgr.entries()) {
    attachedTabs.push({
      tabId: id,
      url: entry.url || '',
      title: entry.title || '',
      sessionId: entry.sessionId,
      targetId: entry.targetId,
      state: entry.state,
      active: id === tabId,
    })
  }
  return {
    tabId,
    url: tab.url || '',
    title: tab.title || '',
    attachedTabs,
  }
}

export async function extBrowserSnapshot(tabId, params) {
  const p = params || {}
  const mode = p.mode === 'efficient' ? 'efficient' : 'flat'
  const maxElements = Math.min(2000, Math.max(1, Number(p.maxElements) || (mode === 'efficient' ? 320 : 200)))
  const maxChars = Math.min(500000, Math.max(2000, Number(p.maxChars) || (mode === 'efficient' ? 10000 : 80000)))
  const maxDepth = Math.min(20, Math.max(2, Number(p.maxDepth) || 6))

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts) => {
      const INTERACTIVE_SELECTOR = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
        '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
      ].join(',')

      const SKIP = new Set([
        'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK',
      ])

      for (const el of document.querySelectorAll('[data-accio-ref]')) {
        el.removeAttribute('data-accio-ref')
      }

      function deepCollect(root, out) {
        for (const el of root.querySelectorAll('*')) {
          if (SKIP.has(el.tagName)) continue
          if (el.matches(INTERACTIVE_SELECTOR)) out.push(el)
          if (el.shadowRoot) deepCollect(el.shadowRoot, out)
        }
      }

      function deepElementFromPoint(x, y) {
        const el = document.elementFromPoint(x, y)
        if (el?.shadowRoot) {
          const inner = el.shadowRoot.elementFromPoint(x, y)
          if (inner && inner !== el) return inner
        }
        return el
      }

      function isDescendantOrSelf(node, target) {
        let cur = node
        while (cur) {
          if (cur === target) return true
          if (cur.parentElement) { cur = cur.parentElement; continue }
          const root = cur.getRootNode()
          cur = root instanceof ShadowRoot ? root.host : null
        }
        return false
      }

      function isVisible(el, rect, vw, vh) {
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return false
        const clipped = {
          left: Math.max(rect.left, 0), top: Math.max(rect.top, 0),
          right: Math.min(rect.right, vw), bottom: Math.min(rect.bottom, vh),
        }
        const cw = clipped.right - clipped.left
        const ch = clipped.bottom - clipped.top
        if (cw < 3 || ch < 3) return false
        const cols = Math.min(4, Math.max(1, Math.round(cw / 20)))
        const rows = Math.min(4, Math.max(1, Math.round(ch / 20)))
        let hits = 0, total = 0
        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            const px = clipped.left + (cols > 0 ? (c / cols) * cw : cw / 2)
            const py = clipped.top + (rows > 0 ? (r / rows) * ch : ch / 2)
            const top = deepElementFromPoint(px, py)
            if (top && isDescendantOrSelf(top, el)) hits++
            total++
          }
        }
        return total > 0 && (hits / total) >= 0.3
      }

      function roleOf(el) {
        const r = el.getAttribute('role')
        if (r) return r
        const tag = el.tagName.toLowerCase()
        if (tag === 'a' && el.getAttribute('href')) return 'link'
        if (tag === 'button') return 'button'
        if (tag === 'select') return 'combobox'
        if (tag === 'textarea') return 'textbox'
        if (tag === 'input') {
          const t = (el.type || 'text').toLowerCase()
          if (t === 'checkbox') return 'checkbox'
          if (t === 'radio') return 'radio'
          if (t === 'submit' || t === 'button' || t === 'reset') return 'button'
          if (t === 'search') return 'searchbox'
          return 'textbox'
        }
        if (tag === 'option') return 'option'
        return 'generic'
      }

      function labelOf(el) {
        const id = el.getAttribute('id')
        if (id) {
          try {
            const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            const lab = document.querySelector(`label[for="${esc}"]`)
            if (lab?.textContent?.trim()) return lab.textContent.trim().slice(0, 120)
          } catch { /* invalid selector */ }
        }
        const al = el.getAttribute('aria-label')
        if (al?.trim()) return al.trim().slice(0, 120)
        const ph = el.getAttribute('placeholder')
        if (ph?.trim()) return ph.trim().slice(0, 120)
        const t = (el.textContent || el.value || el.title || '').replace(/\s+/g, ' ').trim()
        return t.slice(0, 120)
      }

      const vw = window.innerWidth || 1
      const vh = window.innerHeight || 1
      const candidates = []
      deepCollect(document, candidates)

      const lines = []
      if (opts.mode === 'efficient') {
        function walkHeading(node, d) {
          if (d > opts.maxDepth || lines.length > 40) return
          if (node.nodeType !== 1) return
          if (SKIP.has(node.tagName)) return
          const tag = node.tagName
          if (/^H[1-6]$/.test(tag)) {
            const indent = '  '.repeat(Math.min(d, opts.maxDepth))
            lines.push(`${indent}- ${tag.toLowerCase()} "${(node.textContent || '').trim().slice(0, 200)}"`)
          }
          for (const ch of node.children) walkHeading(ch, d + 1)
        }
        walkHeading(document.body, 0)
        if (lines.length) lines.push('---')
      }

      let idx = 0
      for (const el of candidates) {
        if (idx >= opts.maxElements) break
        const rect = el.getBoundingClientRect()
        if (rect.width < 5 || rect.height < 5) continue
        try {
          const st = getComputedStyle(el)
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue
        } catch { /* */ }
        if (!isVisible(el, rect, vw, vh)) continue

        idx++
        const ref = `e${idx}`
        el.setAttribute('data-accio-ref', ref)
        const role = roleOf(el)
        const lab = labelOf(el).replace(/"/g, '\\"')
        const indent = opts.mode === 'efficient' ? '  ' : ''
        lines.push(`${indent}- ${ref} [${role}] "${lab}"`)
        if (lines.join('\n').length > opts.maxChars) {
          lines.pop()
          el.removeAttribute('data-accio-ref')
          idx--
          lines.push(`… (truncated at ${opts.maxChars} chars, ${idx} refs assigned)`)
          break
        }
      }

      const snapshot = lines.join('\n')
      return {
        snapshot,
        lines,
        mode: opts.mode,
        url: location.href,
        title: document.title,
        viewport: { width: vw, height: vh, dpr: window.devicePixelRatio || 1 },
        refCount: idx,
      }
    },
    args: [{ mode, maxElements, maxChars, maxDepth }],
  })
  return unwrapScriptResult(results, 'Extension.browserSnapshot')
}

export async function extBrowserClick(tabId, params) {
  const p = { ...(params || {}) }
  if (p.ref != null && p.index == null && !p.selector && (p.x == null || p.y == null)) {
    const ref = String(p.ref).trim()
    const rid = ref.startsWith('e') ? ref : `e${ref}`
    p.selector = `[data-accio-ref="${rid}"]`
  }
  return extClick(tabId, p)
}

export async function extBrowserFill(tabId, params) {
  const p = params || {}
  const fields = Array.isArray(p.fields) ? p.fields : []
  if (fields.length === 0) {
    throw new Error('Extension.browserFill: fields array is required')
  }
  const pressBeforeFill = p.pressBeforeFill !== false
  const clickSettleMs = Math.min(200, Math.max(0, Number(p.clickSettleMs) || 16))
  const doubleCommit = p.doubleCommit !== false

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (args) => {
      const flds = args.fields
      const pbf = args.pressBeforeFill
      const csm = args.clickSettleMs
      const dc = args.doubleCommit

      function deepQuery(root, sel) {
        const found = root.querySelector(sel)
        if (found) return found
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const inner = deepQuery(el.shadowRoot, sel)
            if (inner) return inner
          }
        }
        return null
      }

      function setNativeValue(el, text) {
        const tag = el.tagName
        if (tag === 'SELECT') {
          const opt = [...el.options].find(
            (o) => o.value === text || o.textContent.trim() === text,
          )
          if (opt) el.selectedIndex = opt.index
          else el.value = text
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return
        }
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          if (nativeSet) nativeSet.call(el, text)
          else el.value = text
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return
        }
        if (el.getAttribute('contenteditable') === 'true') {
          el.focus()
          document.execCommand('selectAll')
          document.execCommand('insertText', false, text)
          return
        }
      }

      function clickCenter(el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const baseOpts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button: 0, detail: 1 }
        el.dispatchEvent(new MouseEvent('mousedown', baseOpts))
        el.dispatchEvent(new MouseEvent('mouseup', baseOpts))
        el.dispatchEvent(new MouseEvent('click', baseOpts))
      }

      const out = []
      for (const f of flds) {
        const refRaw = f?.ref != null ? String(f.ref).trim() : ''
        if (!refRaw) {
          out.push({ ref: '', ok: false, error: 'Missing ref' })
          continue
        }
        const rid = refRaw.startsWith('e') ? refRaw : `e${refRaw}`
        const sel = `[data-accio-ref="${rid}"]`
        const el = deepQuery(document, sel)
        if (!el) {
          out.push({ ref: rid, ok: false, error: 'Element not found' })
          continue
        }
        const text = f.value != null ? String(f.value) : ''
        if (pbf) {
          clickCenter(el)
          const deadline = Date.now() + csm
          while (Date.now() < deadline) { /* sync settle */ }
        }
        el.focus()
        setNativeValue(el, text)
        if (dc) setNativeValue(el, text)
        out.push({ ref: rid, ok: true })
      }
      return { success: true, results: out }
    },
    args: [{ fields, pressBeforeFill, clickSettleMs, doubleCommit }],
  })
  return unwrapScriptResult(results, 'Extension.browserFill')
}

export async function extBrowserScreenshot(tabId, params) {
  return extCaptureViewport(tabId, params || {})
}
