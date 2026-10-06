import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatScrollController, CHAT_NEAR_BOTTOM_PX } from './chat-scroll.ts';

function fixture(mediaReady = true) {
  const metrics = { scrollTop: 0, scrollHeight: 2400, clientHeight: 600, mediaReady };
  const frames = new Map<number, () => void>();
  const scrolls: { top: number; behavior: ScrollBehavior }[] = [];
  let id = 0;
  let away = false;
  let anchored = true;
  const controller = new ChatScrollController({
    measure: () => ({ ...metrics }),
    scrollTo: (top, behavior) => {
      scrolls.push({ top, behavior });
      if (behavior !== 'smooth') metrics.scrollTop = top;
    },
    anchor: (following) => { anchored = following; },
    away: (value) => { away = value; },
    requestFrame: (callback) => { frames.set(++id, callback); return id; },
    cancelFrame: (frame) => { frames.delete(frame); },
  });
  const flush = () => {
    let remaining = 20;
    while (frames.size) {
      assert.ok(remaining-- > 0, 'Initialization must settle without continuous RAF polling');
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback());
    }
  };
  return { controller, metrics, scrolls, flush, away: () => away, anchored: () => anchored, frames };
}

test('opening/restoring waits for persisted data and asynchronous generated-image layout', () => {
  const f = fixture(false);
  f.controller.setReady(false);
  f.flush();
  assert.equal(f.metrics.scrollTop, 1800);
  f.controller.scrolled(); // Initialization writes are not manual scrolling.
  f.metrics.scrollHeight += 500;
  f.controller.setReady(true);
  f.flush();
  assert.equal(f.metrics.scrollTop, 2300);
  f.metrics.mediaReady = true;
  f.metrics.scrollHeight += 384;
  f.controller.refresh(); // Image load/metadata and ResizeObserver signal.
  f.flush();
  assert.equal(f.metrics.scrollTop, f.metrics.scrollHeight - f.metrics.clientHeight);
  assert.equal(f.away(), false);
  assert.equal(f.frames.size, 0);
});

test('cached media settles immediately using layout frames, without requiring another load event', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  assert.equal(f.metrics.scrollTop, 1800);
  assert.equal(f.away(), false);
  assert.equal(f.scrolls.length, 3);
  assert.equal(f.frames.size, 0);
});

test('reading older messages preserves position during new messages and late media restoration', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  f.controller.userInteracted();
  f.metrics.scrollTop = 700;
  f.controller.scrolled();
  assert.equal(f.away(), true);
  assert.equal(f.anchored(), false);
  const writes = f.scrolls.length;
  f.metrics.scrollHeight += 600;
  f.controller.refresh();
  f.flush();
  assert.equal(f.metrics.scrollTop, 700);
  assert.equal(f.scrolls.length, writes);
  assert.equal(f.away(), true);
});

test('manual scrolling while images are still restoring cancels initial forcing', () => {
  const f = fixture(false);
  f.controller.setReady(false);
  f.flush();
  f.controller.userInteracted();
  f.metrics.scrollTop = 300;
  f.controller.scrolled();
  f.metrics.mediaReady = true;
  f.metrics.scrollHeight += 500;
  f.controller.setReady(true);
  f.flush();
  assert.equal(f.metrics.scrollTop, 300);
  assert.equal(f.away(), true);
});

test('button visibility changes only at near-bottom threshold, without scrolling by itself', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  const writes = f.scrolls.length;
  f.metrics.scrollTop = 1800 - CHAT_NEAR_BOTTOM_PX - 1;
  f.controller.scrolled();
  assert.equal(f.away(), true);
  f.metrics.scrollTop = 1800 - CHAT_NEAR_BOTTOM_PX;
  f.controller.scrolled();
  assert.equal(f.away(), false);
  f.metrics.scrollTop = 1800;
  f.controller.scrolled();
  assert.equal(f.away(), false);
  assert.equal(f.scrolls.length, writes);
});

test('tapping jump smoothly targets latest, hides near the bottom, and follows later messages', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  f.metrics.scrollTop = 400;
  f.controller.scrolled();
  f.controller.jumpToLatest();
  assert.deepEqual(f.scrolls.at(-1), { top: 1800, behavior: 'smooth' });
  f.metrics.scrollTop = 900;
  f.controller.scrolled();
  assert.equal(f.away(), true);
  f.metrics.scrollTop = 1800;
  f.controller.scrolled();
  assert.equal(f.away(), false);
  f.metrics.scrollHeight += 200;
  f.controller.refresh();
  f.flush();
  assert.equal(f.metrics.scrollTop, 2000);
});

test('new messages follow when already near bottom without reverting to unconditional auto-scroll', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  f.controller.scrolled();
  f.metrics.scrollTop = 1760;
  f.controller.scrolled();
  f.metrics.scrollHeight += 150;
  f.controller.refresh();
  f.flush();
  assert.equal(f.metrics.scrollTop, 1950);
  assert.equal(f.away(), false);
});

test('keyboard/visual-viewport resizing preserves older-history position and anchors latest when appropriate', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  f.metrics.clientHeight = 300;
  f.controller.refresh();
  f.flush();
  assert.equal(f.metrics.scrollTop, 2100);
  f.controller.userInteracted();
  f.metrics.scrollTop = 500;
  f.controller.scrolled();
  f.metrics.clientHeight = 600;
  f.controller.refresh();
  f.flush();
  assert.equal(f.metrics.scrollTop, 500);
  assert.equal(f.away(), true);
});

test('switching threads disposes pending restoration work and reinitializes the next thread', () => {
  const f = fixture(false);
  f.controller.setReady(true);
  f.controller.dispose();
  f.flush();
  assert.equal(f.metrics.scrollTop, 0);
  const next = fixture();
  next.controller.setReady(true);
  next.flush();
  assert.equal(next.metrics.scrollTop, 1800);
});

test('user input interrupts smooth jumping and prevents later layout signals restarting it', () => {
  const f = fixture();
  f.controller.setReady(true);
  f.flush();
  f.metrics.scrollTop = 400;
  f.controller.scrolled();
  f.controller.jumpToLatest();
  f.metrics.scrollTop = 900;
  f.controller.userInteracted();
  f.controller.scrolled();
  f.metrics.scrollHeight += 100;
  f.controller.refresh();
  f.flush();
  assert.equal(f.metrics.scrollTop, 900);
  assert.equal(f.away(), true);
});
