/**
 * Nib — Answer Hider
 *
 * Based on the AP Classroom Answer Hider app.
 * Injects CSS to hide correct/incorrect indicators and provides a
 * floating toggle panel in the top frame.
 */
(() => {
  'use strict';

  if (window.__cbhInjected_v2) return;
  window.__cbhInjected_v2 = true;

  const MESSAGE_SOURCE = 'cb-nexus-hider';

  // ── CSS that hides answer indicators ─────────────────────────────────────
  const HIDE_CSS = `
.mcq-option.--correct,
.mcq-option.--incorrect {
  background-color: rgba(255,255,255,1) !important;
  border: 0 !important;
}
.--chosen {
  color: inherit !important;
  background-color: inherit !important;
}
.response-analysis-wrapper,
.LearnosityDistractor {
  display: none !important;
}
`;

  // ── CSS for the floating panel UI ────────────────────────────────────────
  const PANEL_CSS = `
.cbh-panel {
  position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
  pointer-events: auto; display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; background-color: #050505; color: #ededed;
  border-radius: 12px; border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px; user-select: none; transition: all .25s ease;
}
.cbh-panel::before {
  content: ""; position: absolute; inset: 0; border-radius: 12px;
  background: radial-gradient(100% 100% at 50% 0%, rgba(255,255,255,0.06) 0%, transparent 100%);
  pointer-events: none;
}
.cbh-panel--collapsed { padding: 8px; gap: 0; }
.cbh-panel--collapsed .cbh-title, .cbh-panel--collapsed .cbh-switch,
.cbh-panel--collapsed .cbh-status { display: none !important; }
.cbh-title { font-weight: 500; white-space: nowrap; }
.cbh-switch { position: relative; display: inline-block; flex-shrink: 0; width: 36px; height: 20px; cursor: pointer; }
.cbh-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.cbh-slider {
  position: absolute; inset: 0; background: #121212;
  border-radius: 20px; border: 1px solid rgba(255,255,255,0.16); transition: 0.3s;
  box-sizing: border-box;
}
.cbh-slider::before {
  content: ""; position: absolute; left: 2px; top: 50%; transform: translateY(-50%);
  width: 14px; height: 14px; background: #71717a; border-radius: 50%; transition: 0.3s;
}
.cbh-switch input:checked + .cbh-slider { background: #ffffff; border-color: #ffffff; }
.cbh-switch input:checked + .cbh-slider::before { transform: translate(16px, -50%); background: #000; }
.cbh-status {
  padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase;
  background: #ffffff; color: #000; transition: all .2s; border: 1px solid #fff;
}
.cbh-status--showing { background: rgba(239, 68, 68, 0.1); color: #fca5a5; border-color: rgba(239, 68, 68, 0.2); }
.cbh-collapse-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border: none; border-radius: 4px;
  background: transparent; color: #a1a1aa; font-size: 14px; cursor: pointer;
  transition: all .2s; position: relative; z-index: 2;
}
.cbh-panel--collapsed .cbh-collapse-btn { width: 22px; height: 22px; }
.cbh-collapse-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
`;

  // ── State ────────────────────────────────────────────────────────────────
  let hideStyleEl = null;
  let panelStyleEl = null;
  let hiding = true;
  let panelBuilt = false;
  let panelRefs = null;
  let panelEl = null;
  let panelVisible = true;

  const isTopFrame = () => window.top === window.self;

  function setHiding(on, options = {}) {
    const { broadcast = true } = options;
    hiding = !!on;
    if (hideStyleEl) hideStyleEl.media = hiding ? 'all' : 'not all';
    updatePanelState();
    if (broadcast) {
      broadcastStateToChildFrames();
    }
  }

  function injectHideStyles() {
    if (hideStyleEl) return;
    const head = document.head || document.documentElement;
    // Remove old styles from previous runs if any
    Array.from(head.querySelectorAll('style')).forEach(s => {
      if (s.textContent.includes('.mcq-option.--correct') || s.textContent.includes('.response-analysis-wrapper')) s.remove();
    });
    hideStyleEl = document.createElement('style');
    hideStyleEl.textContent = HIDE_CSS;
    head.appendChild(hideStyleEl);
    setHiding(hiding, { broadcast: false });
  }

  function injectPanelStyles() {
    if (panelStyleEl) return;
    const head = document.head || document.documentElement;
    // Remove old styles from previous runs if any
    Array.from(head.querySelectorAll('style')).forEach(s => {
      if (s.textContent.includes('.cbh-panel {') || s.textContent.includes('.cbh-panel::before')) s.remove();
    });
    panelStyleEl = document.createElement('style');
    panelStyleEl.textContent = PANEL_CSS;
    head.appendChild(panelStyleEl);
  }

  function applyPanelVisibility() {
    if (!panelEl) return;
    panelEl.style.setProperty('display', panelVisible ? 'flex' : 'none', 'important');
    
    // Fallback: hide any duplicate panels left over from previous script injections
    document.querySelectorAll('.cbh-panel').forEach(el => {
      if (el !== panelEl) {
        el.style.setProperty('display', panelVisible ? 'flex' : 'none', 'important');
      }
    });
  }

  function setPanelVisible(visible) {
    panelVisible = !!visible;
    applyPanelVisibility();
    return panelVisible;
  }

  function postMessageSafe(target, data) {
    try {
      if (target && typeof target.postMessage === 'function') {
        target.postMessage(data, '*');
      }
    } catch (e) {
      // ignore
    }
  }

  function broadcastStateToChildFrames() {
    const payload = { source: MESSAGE_SOURCE, type: 'cbh-toggle', hiding };
    document.querySelectorAll('iframe').forEach((frame) => {
      postMessageSafe(frame.contentWindow, payload);
    });
  }

  function buildPanel() {
    if (panelBuilt || !isTopFrame()) return;
    panelBuilt = true;

    // Remove any previously injected duplicate panels to prevent glitchy behavior
    document.querySelectorAll('.cbh-panel').forEach(el => el.remove());

    injectPanelStyles();

    const panel = document.createElement('div');
    panel.className = 'cbh-panel';
    panelEl = panel;

    const title = document.createElement('span');
    title.className = 'cbh-title';
    title.textContent = 'Nib Hider';
    panel.appendChild(title);

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'cbh-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    const slider = document.createElement('span');
    slider.className = 'cbh-slider';
    toggleWrap.appendChild(checkbox);
    toggleWrap.appendChild(slider);
    panel.appendChild(toggleWrap);

    const status = document.createElement('span');
    status.className = 'cbh-status';

    panelRefs = { checkbox, status };
    updatePanelState();

    checkbox.addEventListener('change', () => {
      setHiding(checkbox.checked);
    });
    panel.appendChild(status);

    let collapsed = false;
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'cbh-collapse-btn';
    collapseBtn.type = 'button';
    collapseBtn.textContent = '\u2212';
    collapseBtn.title = 'Minimize';
    collapseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      collapsed = !collapsed;
      panel.classList.toggle('cbh-panel--collapsed', collapsed);
      collapseBtn.textContent = collapsed ? '+' : '\u2212';
      collapseBtn.title = collapsed ? 'Expand' : 'Minimize';
    });
    panel.appendChild(collapseBtn);

    document.body.appendChild(panel);
    applyPanelVisibility();

    // Sync current state to child frames now and when new iframes appear.
    broadcastStateToChildFrames();
    const observer = new MutationObserver((mutations) => {
      let sawIframe = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeType !== 1) continue;
          if (node.tagName === 'IFRAME') {
            sawIframe = true;
            break;
          }
          if (node.querySelector && node.querySelector('iframe')) {
            sawIframe = true;
            break;
          }
        }
        if (sawIframe) break;
      }
      if (sawIframe) broadcastStateToChildFrames();
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  function updatePanelState() {
    if (!panelRefs) return;
    panelRefs.checkbox.checked = hiding;
    panelRefs.status.textContent = hiding ? 'Hidden' : 'Showing';
    panelRefs.status.classList.toggle('cbh-status--showing', !hiding);
  }

  function handleMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== MESSAGE_SOURCE) return;

    if (data.type === 'cbh-toggle' || data.type === 'cbh-state') {
      setHiding(!!data.hiding, { broadcast: true });
      return;
    }

    if (data.type === 'cbh-request') {
      postMessageSafe(event.source, {
        source: MESSAGE_SOURCE,
        type: 'cbh-state',
        hiding,
      });
    }
  }

  function requestStateFromParent() {
    if (isTopFrame()) return;
    postMessageSafe(window.parent, {
      source: MESSAGE_SOURCE,
      type: 'cbh-request',
    });
  }

  // ── Bootstrap — nothing runs until body exists ────────────────────────────
  function boot() {
    try {
      if (!document.body) {
        // Retry once in rare cases.
        setTimeout(boot, 200);
        return;
      }
      injectHideStyles();
      buildPanel();
      requestStateFromParent();
    } catch (e) {
      console.error('Answer Hider:', e);
    }
  }

  window.addEventListener('message', handleMessage, false);

  window.__cbhGetHiding = () => hiding;
  window.__cbhSetHiding = (value) => {
    setHiding(!!value);
    return hiding;
  };
  window.__cbhGetPanelVisible = () => (isTopFrame() ? panelVisible : null);
  window.__cbhSetPanelVisible = (value) => {
    if (!isTopFrame()) return null;
    return setPanelVisible(!!value);
  };

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.namespace !== MESSAGE_SOURCE) return;
      if (message.action === 'get') {
        sendResponse({ hiding });
        return true;
      }
      if (message.action === 'set') {
        setHiding(!!message.hiding);
        sendResponse({ hiding });
        return true;
      }
      if (message.action === 'toggle') {
        setHiding(!hiding);
        sendResponse({ hiding });
        return true;
      }
      return true;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
