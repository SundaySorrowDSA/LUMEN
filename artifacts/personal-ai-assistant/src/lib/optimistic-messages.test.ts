import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssistantMessage } from '@workspace/api-client-react';
import {
  appendUniqueMessages,
  buildDisplayMessages,
  dismissFailedDraft,
  restoreFailedDraft,
  type OptimisticMessage,
} from './optimistic-messages.ts';

const submittedAt = '2026-09-24T15:00:00.000Z';
const optimistic: OptimisticMessage = {
  conversationId: 7,
  content: 'Show this immediately',
  submittedAt,
  baselineMessageId: 40,
  status: 'pending',
};
const userMessage: AssistantMessage = {
  id: 41,
  conversationId: 7,
  role: 'user',
  content: optimistic.content,
  createdAt: '2026-09-24T15:00:01.000Z',
  model: null,
  metadata: null,
};
const assistantMessage: AssistantMessage = {
  id: 42,
  conversationId: 7,
  role: 'assistant',
  content: 'Done.',
  createdAt: '2026-09-24T15:00:02.000Z',
  model: 'Ren',
  metadata: null,
};

test('adds the submitted text to the display immediately', () => {
  const displayed = buildDisplayMessages([], [optimistic]);

  assert.equal(displayed.length, 1);
  assert.equal(displayed[0]?.content, optimistic.content);
  assert.equal('optimistic' in displayed[0]!, true);
  assert.equal(displayed[0]?.status, 'pending');
});

test('reconciles with authoritative messages and prevents duplicate IDs', () => {
  const canonical = appendUniqueMessages(
    [userMessage],
    [userMessage, assistantMessage, assistantMessage],
  );
  const displayed = buildDisplayMessages(canonical, [optimistic]);

  assert.deepEqual(displayed.map((message) => message.id), [41, 42]);
});

test('keeps failed submitted text visible without creating another message', () => {
  const failed = { ...optimistic, status: 'failed' as const };
  const displayed = buildDisplayMessages([], [failed]);

  assert.equal(displayed.length, 1);
  assert.equal(displayed[0]?.content, optimistic.content);
  assert.equal(displayed[0]?.status, 'failed');
});

test('does not reconcile a failed draft against an older matching server message', () => {
  const failed = { ...optimistic, baselineMessageId: 41, status: 'failed' as const };
  const displayed = buildDisplayMessages([userMessage], [failed]);

  assert.deepEqual(displayed.map((message) => message.id), [
    41,
    `optimistic-7-${submittedAt}`,
  ]);
});

test('keeps a failed draft across refreshed canonical messages', () => {
  const failed = { ...optimistic, baselineMessageId: 42, status: 'failed' as const };
  const displayedBefore = buildDisplayMessages([], [failed]);
  const displayedAfter = buildDisplayMessages([userMessage, assistantMessage], [failed]);

  assert.equal(displayedBefore.at(-1)?.content, optimistic.content);
  assert.equal(displayedAfter.at(-1)?.content, optimistic.content);
  assert.equal(displayedAfter.at(-1)?.status, 'failed');
});

test('keeps earlier failed text visible during a later submission', () => {
  const failed = { ...optimistic, status: 'failed' as const };
  const later = {
    ...optimistic,
    content: 'A later message',
    submittedAt: '2026-09-24T15:01:00.000Z',
  };
  const displayed = buildDisplayMessages([], [failed, later]);

  assert.deepEqual(displayed.map((message) => message.content), [
    optimistic.content,
    later.content,
  ]);
});

test('Restore returns the original text without removing or sending the draft', () => {
  const failed = { ...optimistic, status: 'failed' as const };
  const result = restoreFailedDraft([failed], submittedAt);

  assert.equal(result.composer, optimistic.content);
  assert.deepEqual(result.drafts, [failed]);
});

test('Dismiss removes only the selected failed draft', () => {
  const failed = { ...optimistic, status: 'failed' as const };
  const other = {
    ...failed,
    content: 'Keep me',
    submittedAt: '2026-09-24T15:02:00.000Z',
  };

  assert.deepEqual(dismissFailedDraft([failed, other], submittedAt), [other]);
});
