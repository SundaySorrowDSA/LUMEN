import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { diagnosticScript, previewErrorDiagnostics } from './preview-error-diagnostics';

test('preview diagnostics preserve non-Error reasons and source details without cancelling events', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const window = {
    parent: {},
    addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback),
    __lumenPreviewDiagnostics: undefined as unknown,
  };
  runInNewContext(diagnosticScript, {
    window, navigator: { userAgent: 'Diagnostic fixture' }, URL,
    location: { href: 'https://example.test/' },
  });
  const emit = (type: string, properties: Record<string, unknown>) => {
    listeners.get(type)!({
      type, ...properties,
      preventDefault: () => assert.fail('Must not suppress errors'),
      stopImmediatePropagation: () => assert.fail('Must not hide errors from the overlay'),
    });
  };
  emit('message', { data: { type: 'SCREENSHOT_PAGE', privatePayload: 'not logged' }, origin: 'https://replit.com' });
  emit('unhandledrejection', { reason: { name: 'DOMException', message: 'Share failed', stack: 'original-stack', code: 20 } });
  emit('error', { error: null, message: 'Script error.', filename: 'https://example.test/injected.js?token=secret', lineno: 9, colno: 4 });
  emit('unhandledrejection', { reason: 'Bearer secret sk-example123' });
  const state = window.__lumenPreviewDiagnostics as { queue: Array<Record<string, any>> };
  assert.equal(state.queue[0].fields.message, 'Share failed');
  assert.equal(state.queue[0].fields.stack, 'original-stack');
  assert.equal(state.queue[0].fields.code, '20');
  assert.equal(state.queue[0].recentPreviewMessages[0].type, 'SCREENSHOT_PAGE');
  assert.ok(!JSON.stringify(state.queue).includes('privatePayload'));
  assert.equal(state.queue[1].primitiveReason, 'null');
  assert.equal(state.queue[1].eventMessage, 'Script error.');
  assert.equal(state.queue[1].filename, 'https://example.test/injected.js');
  assert.equal(state.queue[1].line, 9);
  assert.equal(state.queue[2].primitiveReason, 'Bearer [REDACTED] [REDACTED]');
  assert.equal(previewErrorDiagnostics().apply, 'serve', 'Diagnostics must not enter production builds');
});
