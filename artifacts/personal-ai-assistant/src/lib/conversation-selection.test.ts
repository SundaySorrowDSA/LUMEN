import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConversationSelection } from './conversation-selection.ts';

const threads = [{ id: 1, title: 'A place to think' }, { id: 2, title: 'Another user thread' }];
test('canonical Ren thread is default, independent of recency or response order', () => {
  assert.equal(resolveConversationSelection(null, [...threads].reverse(), 2), 1);
});
test('a newer automated fixture never changes an explicit user selection', () => {
  assert.equal(resolveConversationSelection(2, [{ id: 3, title: 'Fixture' }, ...threads], 1), 2);
});
test('archived or removed selection falls back to canonical thread', () => {
  assert.equal(resolveConversationSelection(21, threads, 1), 1);
});
