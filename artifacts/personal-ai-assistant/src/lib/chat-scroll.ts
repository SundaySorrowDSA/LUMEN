export const CHAT_NEAR_BOTTOM_PX = 80;

type Metrics = { scrollTop: number; scrollHeight: number; clientHeight: number; mediaReady: boolean };
export type ChatScrollPort = {
  measure: () => Metrics;
  scrollTo: (top: number, behavior: ScrollBehavior) => void;
  anchor: (following: boolean) => void;
  away: (away: boolean) => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
};

/** One owner of scrolling: layout changes are not interpreted as user intent. */
export class ChatScrollController {
  private initial = true;
  private ready = false;
  private following = true;
  private jumping = false;
  private expectedTop: number | null = null;
  private frame: number | null = null;
  private stableFrames = 0;
  private signature = '';
  private disposed = false;
  private away = false;
  private port: ChatScrollPort;

  constructor(port: ChatScrollPort) {
    this.port = port;
    port.anchor(true);
    port.away(false);
  }

  setReady(ready: boolean) {
    this.ready = ready;
    this.refresh();
  }

  refresh = () => {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.port.requestFrame(() => {
      this.frame = null;
      if (this.disposed) return;
      const metrics = this.port.measure();
      const bottom = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
      if (this.initial || this.following) {
        if (!this.jumping || this.expectedTop !== bottom) {
          this.expectedTop = bottom;
          this.port.scrollTo(bottom, this.jumping ? 'smooth' : 'instant');
        }
      }
      if (this.initial) {
        const signature = `${metrics.scrollHeight}:${metrics.clientHeight}`;
        if (!this.ready || !metrics.mediaReady) {
          this.stableFrames = 0;
          this.signature = '';
        } else {
          this.stableFrames = signature === this.signature ? this.stableFrames + 1 : 0;
          this.signature = signature;
          if (this.stableFrames >= 2) this.initial = false;
          else this.refresh();
        }
      }
      this.publish();
    });
  };

  userInteracted = () => {
    if (this.disposed) return;
    this.initial = false;
    this.following = false;
    if (this.jumping) this.port.scrollTo(this.port.measure().scrollTop, 'instant');
    this.jumping = false;
    this.expectedTop = null;
    this.port.anchor(false);
  };

  scrolled = () => {
    if (this.disposed || this.initial) return;
    const metrics = this.port.measure();
    const distance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
    if (this.jumping) {
      if (distance <= 1) this.jumping = false;
    } else if (this.expectedTop !== null && Math.abs(metrics.scrollTop - this.expectedTop) <= 1) {
      this.expectedTop = null;
    } else {
      this.following = distance <= CHAT_NEAR_BOTTOM_PX;
      this.port.anchor(this.following);
    }
    this.publish();
  };

  jumpToLatest = () => {
    this.initial = false;
    this.following = true;
    this.jumping = true;
    this.port.anchor(true);
    this.expectedTop = Math.max(0, this.port.measure().scrollHeight - this.port.measure().clientHeight);
    this.port.scrollTo(this.expectedTop, 'smooth');
    this.publish();
  };

  private publish() {
    const metrics = this.port.measure();
    const away = !this.initial &&
      metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop > CHAT_NEAR_BOTTOM_PX;
    if (away !== this.away) {
      this.away = away;
      this.port.away(away);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.frame !== null) this.port.cancelFrame(this.frame);
  }
}
