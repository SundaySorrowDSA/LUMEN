import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChatScrollController } from '../lib/chat-scroll';

export function useChatScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  conversationId: number | null,
  restored: boolean,
) {
  const controller = useRef<ChatScrollController | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    setAwayFromLatest(false);
    if (!container || !content || conversationId === null) return;
    const originalAnchor = container.style.overflowAnchor;
    const scroll = new ChatScrollController({
      measure: () => ({
        scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight,
        mediaReady: Array.from(content.querySelectorAll('img, video, audio')).every((media) =>
          media instanceof HTMLImageElement ? media.complete : (media as HTMLMediaElement).readyState >= 1 || Boolean((media as HTMLMediaElement).error)),
      }),
      scrollTo: (top, behavior) => {
        if (behavior === 'smooth') container.scrollTo({ top, behavior });
        else container.scrollTop = top; // Direct assignment also works on older iOS Safari.
      },
      anchor: (following) => { container.style.overflowAnchor = following ? 'none' : 'auto'; },
      away: setAwayFromLatest,
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: cancelAnimationFrame,
    });
    controller.current = scroll;
    const resize = new ResizeObserver(scroll.refresh);
    resize.observe(container);
    resize.observe(content);
    const mutations = new MutationObserver(scroll.refresh);
    mutations.observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'width', 'height'] });
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) scroll.userInteracted(); };
    let touchY: number | null = null;
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; };
    const touchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next !== undefined && touchY !== null && next - touchY > 3) scroll.userInteracted();
      touchY = next ?? null;
    };
    const key = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) scroll.userInteracted();
    };
    const pointer = (event: PointerEvent) => {
      // A desktop scrollbar drag is also explicit user intent, including during restoration.
      if (event.pointerType === 'mouse' && event.clientX >= container.getBoundingClientRect().left + container.clientWidth) scroll.userInteracted();
    };
    container.addEventListener('scroll', scroll.scrolled, { passive: true });
    container.addEventListener('wheel', wheel, { passive: true });
    container.addEventListener('touchstart', touchStart, { passive: true });
    container.addEventListener('touchmove', touchMove, { passive: true });
    container.addEventListener('keydown', key);
    container.addEventListener('pointerdown', pointer);
    for (const event of ['load', 'error', 'loadedmetadata', 'loadeddata']) container.addEventListener(event, scroll.refresh, true);
    window.visualViewport?.addEventListener('resize', scroll.refresh);
    window.visualViewport?.addEventListener('scroll', scroll.refresh);
    return () => {
      scroll.dispose();
      controller.current = null;
      resize.disconnect();
      mutations.disconnect();
      container.style.overflowAnchor = originalAnchor;
      container.removeEventListener('scroll', scroll.scrolled);
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('touchstart', touchStart);
      container.removeEventListener('touchmove', touchMove);
      container.removeEventListener('keydown', key);
      container.removeEventListener('pointerdown', pointer);
      for (const event of ['load', 'error', 'loadedmetadata', 'loadeddata']) container.removeEventListener(event, scroll.refresh, true);
      window.visualViewport?.removeEventListener('resize', scroll.refresh);
      window.visualViewport?.removeEventListener('scroll', scroll.refresh);
    };
  }, [conversationId, containerRef, contentRef]);

  useLayoutEffect(() => { controller.current?.setReady(restored); }, [conversationId, restored]);

  return { awayFromLatest, jumpToLatest: () => controller.current?.jumpToLatest() };
}
