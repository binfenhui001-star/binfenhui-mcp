/**
 * CDP command dispatch — main routing logic.
 *
 * Routes incoming forwardCDPCommand messages to the appropriate handler:
 *   Target.*     → target-ops.js   (tab creation, closing, activation)
 *   Extension.*  → content_script/*.js (viewport, snapshot/click/fill, scroll, pressKey,
 *                findKeyword, moveMouse, waitForReady, actionMask, inputEnhanced,
 *                extractContentEnhanced, captureHighlightedViewport, …) + extension-ops.js
 *   Other CDP    → chrome.debugger.sendCommand inside the extension (still **not** a direct
 *                agent→9222 connection — the model only talks to the local relay MCP).
 *
 * @param {import('../tabs/manager.js').TabManager} mgr
 * @returns {(msg: any) => Promise<any>}
 */

import { createTargetOps } from './target-ops.js'
import {
  extGetViewportInfo, extEnsureZoom, extCaptureViewport,
  extExtractContent, extMarkElements, extClick, extInput,
  extBrowserInfo, extBrowserNavigate, extBrowserSnapshot, extBrowserClick, extBrowserFill,
  extBrowserScreenshot,
} from '../../content_script/extension-ops.js'
import { extScroll } from '../../content_script/scroll.js'
import { extPressKey } from '../../content_script/press-key.js'
import { extFindKeyword } from '../../content_script/find-keyword.js'
import { extMoveMouse } from '../../content_script/move-mouse.js'
import { extWaitForReady } from '../../content_script/wait-ready.js'
import { extActionMask } from '../../content_script/action-mask.js'
import { extInputEnhanced } from '../../content_script/input-enhanced.js'
import { extExtractContentEnhanced } from '../../content_script/extract-readability.js'
import { extCaptureHighlightedViewport } from '../../content_script/highlight-screenshot.js'
import { RUNTIME_ENABLE_DELAY, CDP_COMMAND_TIMEOUT, withTimeout } from './utils.js'

/**
 * 解析 session / target / lastAttached；若仍无 tab，则对绝大多数方法回退到
 * 当前聚焦窗口的活动标签（用户正在看的页面），避免首条 `Input.*` / `Extension.*`
 * 等在未带 session_id 时失败。以下 Target 命令不使用该猜侧（避免串队列或误关页）：
 * `Target.createTarget`、`Target.closeAllAgentTabs`、`Target.closeTarget`。
 */
async function resolveTabIdWithActiveFallback(mgr, sessionId, targetId, method) {
  const resolved = mgr.resolveTabId(sessionId, targetId)
  if (resolved != null) return resolved

  if (!shouldUseActiveTabFallback(method)) return null

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const id = tabs[0]?.id
    if (typeof id === 'number' && id >= 0) return id
  } catch (err) {
    console.warn('[accio-relay] active-tab fallback failed:', err)
  }
  return null
}

/** @param {string} method */
function shouldUseActiveTabFallback(method) {
  if (method === 'Target.createTarget') return false
  if (method === 'Target.closeAllAgentTabs') return false
  if (method === 'Target.closeTarget') return false
  return true
}

const MAX_QUEUE_DEPTH = 100
const _tabQueues = new Map()

function getTabQueue(tabId) {
  if (!tabId) return null
  let q = _tabQueues.get(tabId)
  if (!q) {
    q = { running: false, queue: [] }
    _tabQueues.set(tabId, q)
  }
  return q
}

async function processQueue(q) {
  if (q.running) return
  q.running = true
  try {
    while (q.queue.length > 0) {
      const { task, resolve, reject } = q.queue.shift()
      try {
        resolve(await task())
      } catch (err) {
        reject(err)
      }
    }
  } finally {
    q.running = false
  }
}

function enqueueForTab(tabId, task) {
  const q = getTabQueue(tabId)
  if (!q) return task()
  if (q.queue.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new Error(`Tab ${tabId} command queue full (${MAX_QUEUE_DEPTH})`))
  }
  return new Promise((resolve, reject) => {
    q.queue.push({ task, resolve, reject })
    processQueue(q)
  })
}

export function cleanupTabQueue(tabId) {
  _tabQueues.delete(tabId)
}

export function cleanupAllTabQueues() {
  _tabQueues.clear()
}

export function createDispatcher(mgr) {

  const { cdpCreateTarget, cdpCloseTarget, cdpCloseAllAgentTabs, cdpActivateTarget } = createTargetOps(mgr)

  async function cdpRuntimeEnable(debuggee, params) {
    try {
      await chrome.debugger.sendCommand(debuggee, 'Runtime.disable')
      await new Promise((r) => setTimeout(r, RUNTIME_ENABLE_DELAY))
    } catch (err) {
      console.debug('[accio-relay] Runtime.disable pre-step failed:', err)
    }
    return withTimeout(
      chrome.debugger.sendCommand(debuggee, 'Runtime.enable', params),
      CDP_COMMAND_TIMEOUT,
      'Runtime.enable',
    )
  }

  return async function handleForwardCdpCommand(msg) {
    const method = String(msg?.params?.method || '').trim()
    const params = msg?.params?.params || undefined
    const sessionId = typeof msg?.params?.sessionId === 'string' ? msg.params.sessionId : undefined
    // targetId 可能在顶层 msg.params.targetId（来自 external bridge CDP.send），
    // 也可能在 msg.params.params.targetId（来自 relay 桌面端路径）
    const targetId =
      (typeof msg?.params?.targetId === 'string' ? msg.params.targetId : undefined) ??
      (typeof params?.targetId === 'string' ? params.targetId : undefined)
    const tabId = await resolveTabIdWithActiveFallback(mgr, sessionId, targetId, method)

    return enqueueForTab(tabId, async () => {
      // ── Target.* commands (no tabId required for createTarget) ──
      if (method === 'Target.createTarget') return cdpCreateTarget(params)
      if (method === 'Target.closeAllAgentTabs') return cdpCloseAllAgentTabs()

      if (!tabId) {
        throw new Error(
          `No attached tab for method ${method}. Focus a normal http(s) tab, or pass session_id/target_id, or call Target.activateTarget / Target.createTarget first.`,
        )
      }

      mgr.onCdpCommand?.(tabId)

      if (method === 'Target.closeTarget') return cdpCloseTarget(params, tabId)
      if (method === 'Target.activateTarget') return cdpActivateTarget(params, tabId)

      // ── Extension.* virtual commands ──
      if (method === 'Extension.getViewportInfo') {
        await mgr.ensureAttached(tabId)
        return extGetViewportInfo(tabId)
      }
      if (method === 'Extension.ensureZoom') return extEnsureZoom(tabId, params)
      if (method === 'Extension.captureViewport') {
        await mgr.ensureAttached(tabId)
        return extCaptureViewport(tabId, params)
      }
      if (method === 'Extension.extractContent') return extExtractContent(tabId)
      if (method === 'Extension.markElements') return extMarkElements(tabId, params)
      if (method === 'Extension.click') return extClick(tabId, params)
      if (method === 'Extension.input') return extInput(tabId, params)
      if (method === 'Extension.pressKey') return extPressKey(tabId, params)
      if (method === 'Extension.findKeyword') return extFindKeyword(tabId, params)
      if (method === 'Extension.moveMouse') return extMoveMouse(tabId, params)
      if (method === 'Extension.waitForReady') return extWaitForReady(tabId, params)
      if (method === 'Extension.actionMask') return extActionMask(tabId, params)
      if (method === 'Extension.inputEnhanced') return extInputEnhanced(tabId, params)
      if (method === 'Extension.extractContentEnhanced') return extExtractContentEnhanced(tabId)
      if (method === 'Extension.browserInfo') return extBrowserInfo(tabId, mgr)
      if (method === 'Extension.browserNavigate') return extBrowserNavigate(tabId, params)
      if (method === 'Extension.browserSnapshot') return extBrowserSnapshot(tabId, params)
      if (method === 'Extension.browserClick') return extBrowserClick(tabId, params)
      if (method === 'Extension.browserFill') return extBrowserFill(tabId, params)
      if (method === 'Extension.browserScroll') return extScroll(tabId, params, 'Extension.browserScroll')
      if (method === 'Extension.scroll') return extScroll(tabId, params, 'Extension.scroll')
      if (method === 'Extension.browserScreenshot') {
        await mgr.ensureAttached(tabId)
        return extBrowserScreenshot(tabId, params)
      }
      if (method === 'Extension.captureHighlightedViewport') {
        await mgr.ensureAttached(tabId)
        return extCaptureHighlightedViewport(tabId, params)
      }
      // vtab 自动附加：桌面端 browser tool 发现 targetId 是虚拟标签页（vtab-*）时，
      // 通过 relay 调用此命令让扩展执行 chrome.debugger.attach，将虚拟标签页升级为物理附加。
      // 返回附加后的真实 targetId 和 sessionId，供后续 CDP 命令使用。
      // 调用链：browser.ts autoAttachVtab() → relay ensureTargetAttached() → 此处
      if (method === 'Extension.ensureAttach') {
        const ok = await mgr.ensureAttached(tabId)
        if (!ok) throw new Error(`Failed to attach tab ${tabId}`)
        const entry = mgr.get(tabId)
        return { targetId: entry?.targetId, sessionId: entry?.sessionId }
      }

      // ── Standard CDP forwarding (requires debugger attach) ──
      const ok = await mgr.ensureAttached(tabId)
      if (!ok) throw new Error(`Failed to attach debugger to tab ${tabId} for ${method}`)

      /** @type {chrome.debugger.DebuggerSession} */
      const debuggee = { tabId }

      if (method === 'Runtime.enable') return cdpRuntimeEnable(debuggee, params)

      if (method === 'Page.navigate') {
        const url = typeof params?.url === 'string' ? params.url.trim() : ''
        if (url) {
          return extBrowserNavigate(tabId, {
            url,
            waitReady: params?.waitUntil !== 'none',
            timeout: typeof params?.timeout === 'number' ? params.timeout : undefined,
          })
        }
      }

      const tabState = mgr.get(tabId)
      const mainSessionId = tabState?.sessionId
      const debuggerSession =
        sessionId && mainSessionId && sessionId !== mainSessionId
          ? { ...debuggee, sessionId }
          : debuggee

      return withTimeout(
        chrome.debugger.sendCommand(debuggerSession, method, params),
        CDP_COMMAND_TIMEOUT,
        method,
      )
    })
  }
}
