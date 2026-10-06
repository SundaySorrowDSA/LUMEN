import type { Plugin } from 'vite';

// Install before module scripts so the original rejection is observed before
// the runtime overlay normalizes non-Error values. Never cancel the event.
export const diagnosticScript = String.raw`(() => {
  const clean = value => String(value)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|password|code)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 2000);
  const source = value => {
    if (!value || value === 'null') return '';
    try { const url = new URL(value, location.href); return url.origin + url.pathname; }
    catch { return ''; }
  };
  const messages = [];
  const queue = [];
  const state = window.__lumenPreviewDiagnostics = { queue, send: null };
  window.addEventListener('message', event => {
    // Record only message type/origin, never payloads, photos or chat content.
    if (typeof event.data?.type !== 'string') return;
    messages.push({ timestamp: Date.now(), type: clean(event.data.type).slice(0, 100), origin: source(event.origin) });
    if (messages.length > 8) messages.shift();
  });
  const record = (event, reason) => {
    const fields = {};
    for (const key of ['name', 'message', 'stack', 'code', 'domain', 'description', 'localizedDescription', 'type']) {
      try {
        const value = reason?.[key];
        if (['string', 'number', 'boolean'].includes(typeof value)) fields[key] = clean(value);
      } catch {}
    }
    let constructor = '';
    try { constructor = reason?.constructor?.name || ''; } catch {}
    const data = {
      timestamp: Date.now(), event: event.type, reasonType: typeof reason,
      eventConstructor: clean(event.constructor?.name || ''),
      eventMessage: typeof event.message === 'string' ? clean(event.message) : null,
      reasonConstructor: clean(constructor),
      primitiveReason: reason === null ? 'null' : ['undefined', 'string', 'number', 'boolean'].includes(typeof reason) ? clean(reason) : null,
      fields, filename: source(event.filename || ''), line: event.lineno || null, column: event.colno || null,
      targetTag: event.target?.tagName || null,
      targetSource: event.target?.src ? source(event.target.src) : null,
      trusted: event.isTrusted, framed: window.parent !== window,
      userAgent: clean(navigator.userAgent), recentPreviewMessages: messages.slice(),
      // This stack identifies the observer, NOT the original error source.
      observerStack: clean(new Error('Diagnostic observer; not the original throw stack').stack || '')
    };
    if (state.send) state.send(data);
    else { queue.push(data); if (queue.length > 8) queue.shift(); }
  };
  window.addEventListener('error', event => record(event, event.error), true);
  window.addEventListener('unhandledrejection', event => record(event, event.reason));
})();`;

export function previewErrorDiagnostics(): Plugin {
  return {
    name: 'lumen-preview-error-diagnostics',
    apply: 'serve',
    configureServer(server) {
      server.ws.on('lumen:preview-error', data => {
        if (data && typeof data === 'object') {
          server.config.logger.warn(`[LUMEN_PREVIEW_DIAGNOSTIC]${JSON.stringify(data).slice(0, 10000)}`);
        }
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          { tag: 'script', children: diagnosticScript, injectTo: 'head-prepend' },
          {
            tag: 'script', attrs: { type: 'module' }, injectTo: 'head-prepend',
            children: `import { createHotContext } from '/@vite/client';
const hot = createHotContext('/__lumen-preview-diagnostics');
const state = window.__lumenPreviewDiagnostics;
if (state) {
  state.send = data => hot.send('lumen:preview-error', data);
  state.queue.splice(0).forEach(state.send);
}`,
          },
        ];
      },
    },
  };
}
