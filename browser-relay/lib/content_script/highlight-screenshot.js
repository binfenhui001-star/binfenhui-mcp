/**
 * Extension.captureHighlightedViewport — Screenshot with element annotations.
 *
 * Takes a clean screenshot, then draws dashed rectangles and index labels
 * over interactive elements using OffscreenCanvas in the Service Worker.
 *
 * Color scheme follows Manus convention:
 *   button  → yellow, input → coral, select → pink, a → green,
 *   textarea → blue, default → red
 */

import { unwrapScriptResult } from './helpers.js'
import { extCaptureViewport } from './extension-ops.js'

const TAG_COLORS = {
  button: '#FFFF00',
  input: '#FF7F50',
  select: '#FF4162',
  a: '#00FF00',
  textarea: '#0000FF',
}
const DEFAULT_COLOR = '#FF0000'

function colorForTag(tag) {
  return TAG_COLORS[tag] || DEFAULT_COLOR
}

/**
 * Render element annotations onto a screenshot.
 *
 * @param {string} base64Png — Clean screenshot as base64
 * @param {Array<{idx: number, tag: string, rect: {x: number, y: number, w: number, h: number}}>} elements
 * @param {number} width — Viewport width
 * @param {number} height — Viewport height
 * @returns {Promise<string>} Annotated screenshot as base64
 */
export async function renderHighlightedScreenshot(base64Png, elements, width, height) {
  const blob = await (await fetch(`data:image/png;base64,${base64Png}`)).blob()
  const bitmap = await createImageBitmap(blob)

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)

  const scaleX = bitmap.width / width
  const scaleY = bitmap.height / height

  const fontSize = Math.max(10, Math.min(20, Math.round(bitmap.width / 100)))
  ctx.font = `bold ${fontSize}px monospace`
  ctx.textBaseline = 'top'

  const DASH_LENGTH = 4 * scaleX
  const GAP_LENGTH = 8 * scaleX
  const LINE_WIDTH = 2 * scaleX
  const LABEL_PAD = 3 * scaleX

  for (const el of elements) {
    const color = colorForTag(el.tag)
    const x = el.rect.x * scaleX
    const y = el.rect.y * scaleY
    const w = el.rect.w * scaleX
    const h = el.rect.h * scaleY

    ctx.strokeStyle = color
    ctx.lineWidth = LINE_WIDTH
    ctx.setLineDash([DASH_LENGTH, GAP_LENGTH])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])

    const label = String(el.idx)
    const metrics = ctx.measureText(label)
    const lw = metrics.width + LABEL_PAD * 2
    const lh = fontSize + LABEL_PAD * 2

    let lx = x - lw - 2
    let ly = y - 2
    if (lx < 0) lx = x + w + 2
    if (ly < 0) ly = y + h + 2
    if (lx + lw > bitmap.width) lx = x
    if (ly + lh > bitmap.height) ly = y

    ctx.fillStyle = color
    ctx.fillRect(lx, ly, lw, lh)
    ctx.fillStyle = '#000000'
    ctx.fillText(label, lx + LABEL_PAD, ly + LABEL_PAD)
  }

  const outBlob = await canvas.convertToBlob({ type: 'image/png' })
  const buffer = await outBlob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  const chunks = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)))
  }
  return btoa(chunks.join(''))
}

/**
 * Viewport screenshot with dashed boxes + numeric labels on interactive controls.
 * Read-only DOM scan (does not set data-accio-*). Requires debugger attach like captureViewport.
 *
 * @param {number} tabId
 * @param {{ maxElements?: number, format?: string, quality?: number }} [params]
 */
export async function extCaptureHighlightedViewport(tabId, params) {
  const p = params || {}
  const maxElements =
    typeof p.maxElements === 'number' && Number.isFinite(p.maxElements) && p.maxElements > 0
      ? Math.min(300, Math.floor(p.maxElements))
      : 120

  const cap = await extCaptureViewport(tabId, p)
  if (!cap?.data) throw new Error('Extension.captureHighlightedViewport: empty capture')

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
          if (cur.parentElement) {
            cur = cur.parentElement
            continue
          }
          const root = cur.getRootNode()
          cur = root instanceof ShadowRoot ? root.host : null
        }
        return false
      }

      function isVisible(el, rect, vw, vh) {
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return false
        const clipped = {
          left: Math.max(rect.left, 0),
          top: Math.max(rect.top, 0),
          right: Math.min(rect.right, vw),
          bottom: Math.min(rect.bottom, vh),
        }
        const cw = clipped.right - clipped.left
        const ch = clipped.bottom - clipped.top
        if (cw < 3 || ch < 3) return false

        const cols = Math.min(4, Math.max(1, Math.round(cw / 20)))
        const rows = Math.min(4, Math.max(1, Math.round(ch / 20)))
        let hits = 0
        let total = 0
        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            const px = clipped.left + (cols > 0 ? (c / cols) * cw : cw / 2)
            const py = clipped.top + (rows > 0 ? (r / rows) * ch : ch / 2)
            const top = deepElementFromPoint(px, py)
            if (top && isDescendantOrSelf(top, el)) hits++
            total++
          }
        }
        return total > 0 && hits / total >= 0.3
      }

      function collectInteractive(root, out) {
        for (const el of root.querySelectorAll('*')) {
          if (SKIP_TAGS.has(el.tagName)) continue
          if (el.matches(INTERACTIVE_SELECTOR)) out.push(el)
          if (el.shadowRoot) collectInteractive(el.shadowRoot, out)
        }
      }

      const vw = window.innerWidth || 1
      const vh = window.innerHeight || 1
      const candidates = []
      collectInteractive(document, candidates)

      const elements = []
      let idx = 1
      const capMax = options?.maxElements || 120

      for (const el of candidates) {
        if (idx > capMax) break
        const rect = el.getBoundingClientRect()
        if (rect.width < 5 || rect.height < 5) continue

        try {
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            continue
          }
        } catch {
          /* skip */
        }

        if (!isVisible(el, rect, vw, vh)) continue

        const tag = el.tagName.toLowerCase()
        elements.push({
          idx,
          tag,
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        })
        idx++
      }

      return { elements }
    },
    args: [{ maxElements }],
  })

  const collected = unwrapScriptResult(results, 'Extension.captureHighlightedViewport')
  const raw = Array.isArray(collected?.elements) ? collected.elements : []

  const drawn = raw.map((e) => ({
    idx: e.idx,
    tag: String(e.tag || 'div').toLowerCase(),
    rect: e.rect,
  }))

  const annotated = await renderHighlightedScreenshot(cap.data, drawn, cap.width, cap.height)

  return {
    data: annotated,
    width: cap.width,
    height: cap.height,
    dpr: cap.dpr,
    annotatedElementCount: drawn.length,
  }
}
