// Talking to an AI chat host when the editor is embedded in a conversation.
// Speaks MCP Apps (spec 2026-01-26: JSON-RPC over postMessage), and ChatGPT's
// older Apps SDK bridge (window.openai) when that is what is available.
//
//   const host = connectHost({ onData, onContext });
//   host.updateContext(text, structured)   // the AI sees it on its next turn
//   host.sendMessage(text)                 // posts a user message into the chat
//   host.openLink(url), host.toggleFullscreen()
//   host.caps → { message, fullscreen, openLinks }

export function connectHost({ onData, onContext = () => {} }) {
  let id = 0, ready = false, lastData = null;
  const pending = new Map();
  const oa = () => window.openai;
  const caps = { message: false, fullscreen: false, openLinks: false, modelContext: false };
  const post = msg => { if (window.parent !== window) window.parent.postMessage({ jsonrpc: '2.0', ...msg }, '*'); };
  const request = (method, params, timeout = 8000) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    post({ id: i, method, params });
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`${method}: no answer`)); } }, timeout);
  });
  const notify = (method, params) => post({ method, params });
  // Deliver a tool result once; later duplicates (both bridges) are ignored.
  const deliver = data => {
    if (!data || !data.doc) return;
    const key = JSON.stringify(data.doc.o);
    if (key === lastData) return;
    lastData = key;
    onData(data);
  };

  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && pending.has(m.id) && ('result' in m || 'error' in m)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    switch (m.method) {
      case 'ui/notifications/tool-result': deliver(m.params && m.params.structuredContent); break;
      case 'ui/notifications/host-context-changed': onContext(m.params || {}); break;
      case 'ui/resource-teardown': post({ id: m.id, result: {} }); break;
      default: if (m.id != null && m.method) post({ id: m.id, result: {} }); // ping, unknown requests
    }
  });

  // ChatGPT Apps SDK: data and theme arrive as globals, possibly later.
  if (oa()) {
    const g = oa();
    if (g.theme) onContext({ theme: g.theme });
    // A remounted widget keeps the user's edits in widgetState.
    if (g.widgetState && g.widgetState.doc) deliver({ ...(g.toolOutput || {}), doc: g.widgetState.doc });
    else deliver(g.toolOutput);
    window.addEventListener('openai:set_globals', ev => {
      const gl = (ev.detail && ev.detail.globals) || {};
      if (gl.theme) onContext({ theme: gl.theme });
      if (gl.displayMode) onContext({ displayMode: gl.displayMode });
      if (gl.toolOutput) deliver(gl.toolOutput);
    });
    caps.message = !!g.sendFollowUpMessage;
    caps.fullscreen = !!g.requestDisplayMode;
    caps.openLinks = !!g.openExternal;
    caps.modelContext = !!g.setWidgetState;
  }

  const handshake = request('ui/initialize', {
    appInfo: { name: 'geometry-drawer', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26',
  }, oa() ? 2000 : 8000).then(init => {
    const hc = (init && init.hostCapabilities) || {}, ctx = (init && init.hostContext) || {};
    caps.message ||= !!hc.message;
    caps.openLinks ||= !!hc.openLinks;
    caps.modelContext ||= !!hc.updateModelContext;
    caps.fullscreen ||= (ctx.availableDisplayModes || []).includes('fullscreen');
    caps.mcpApps = true;
    onContext(ctx);
    notify('ui/notifications/initialized', {});
    ready = true;
    return true;
  }).catch(() => false);

  let displayMode = 'inline';
  const host = {
    caps, handshake,
    get ready() { return ready; },
    reportSize(height) { if (ready) notify('ui/notifications/size-changed', { height }); },
    updateContext(text, structured) {
      if (ready && caps.modelContext) request('ui/update-model-context', { content: [{ type: 'text', text }], structuredContent: structured }).catch(() => {});
      if (oa() && oa().setWidgetState) oa().setWidgetState({ doc: structured && structured.doc, script: structured && structured.script });
    },
    async sendMessage(text) {
      if (ready && caps.message) { const r = await request('ui/message', { role: 'user', content: [{ type: 'text', text }] }); return !(r && r.isError); }
      if (oa() && oa().sendFollowUpMessage) { await oa().sendFollowUpMessage({ prompt: text }); return true; }
      return false;
    },
    async openLink(url) {
      try {
        if (oa() && oa().openExternal) { oa().openExternal({ href: url }); return; }
        const r = await request('ui/open-link', { url });
        if (r && r.isError) throw new Error('refused');
      } catch { window.open(url, '_blank', 'noopener'); }
    },
    async toggleFullscreen() {
      const mode = displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
      try {
        let r;
        if (ready) r = await request('ui/request-display-mode', { mode });
        else if (oa() && oa().requestDisplayMode) r = await oa().requestDisplayMode({ mode });
        displayMode = (r && r.mode) || mode;
        onContext({ displayMode });
      } catch { /* the host said no */ }
    },
    setDisplayMode(m) { displayMode = m; },
  };
  return host;
}
