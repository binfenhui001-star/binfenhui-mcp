/**
 * Content Script channel — Manus-style DOM interaction.
 *
 * Uses chrome.scripting.executeScript to inject page-level scripts
 * for viewport info, content extraction, element marking, click/input,
 * keyboard, scrolling, keyword search, mouse hover, and Shadow DOM traversal.
 * No debugger attachment required for most DOM operations; viewport screenshots
 * (`Extension.captureHighlightedViewport`, `captureViewport` via debugger) require attach.
 *
 * Active commands (wired into CDP dispatch in lib/cdp/commands/dispatch.js):
 *   extension-ops.js        — Core: viewport, screenshot, content, mark, click, input, browser*
 *   scroll.js               — Extension.browserScroll / Extension.scroll
 *   press-key.js            — Extension.pressKey (key / combo on focused element)
 *   find-keyword.js         — Extension.findKeyword
 *   move-mouse.js           — Extension.moveMouse (hover / menus)
 *   wait-ready.js           — Extension.waitForReady
 *   action-mask.js          — Extension.actionMask (overlay states)
 *   input-enhanced.js       — Extension.inputEnhanced (Draft/Slate/rich text)
 *   extract-readability.js  — Extension.extractContentEnhanced
 *   highlight-screenshot.js — Extension.captureHighlightedViewport + renderHighlightedScreenshot
 *
 * Not wired to dispatch (reserved):
 *   keepalive.js            — MV3 Service Worker heartbeat mechanism
 *
 *   helpers.js              — Shared utilities (unwrapScriptResult)
 */

// ── Active exports ──

export {
  extGetViewportInfo,
  extEnsureZoom,
  extCaptureViewport,
  extExtractContent,
  extMarkElements,
  extClick,
  extInput,
} from './extension-ops.js'

export { extPressKey } from './press-key.js'
export { extScroll } from './scroll.js'
export { extFindKeyword } from './find-keyword.js'
export { extMoveMouse } from './move-mouse.js'
export { extWaitForReady } from './wait-ready.js'
export { extActionMask } from './action-mask.js'
export { extInputEnhanced } from './input-enhanced.js'
export { extExtractContentEnhanced } from './extract-readability.js'
export { extCaptureHighlightedViewport, renderHighlightedScreenshot } from './highlight-screenshot.js'

// ── Reserved / infra (no Extension.* dispatch entry) ──

export { startKeepAlive, stopKeepAlive, registerKeepAliveListener } from './keepalive.js'
