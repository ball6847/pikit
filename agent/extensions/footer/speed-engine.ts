// ═══════════════════════════════════════════════════════════════════════════
// Token Speed Engine
// Measures streaming token throughput in real time using a sliding window.
//
// Counting strategies:
//  - Preferred: provider-reported cumulative output tokens. Adopted once it
//    advances past its baseline and held for the rest of the message, so the
//    anchor survives content-block transitions (thinking -> text -> toolcall)
//    where the cumulative counter keeps climbing.
//  - Fallback: 1 token per delta event, used only until the preferred source
//    demonstrates its first advance (providers that report usage solely in
//    the final chunk, e.g. classic OpenAI chat completions).
//
// TPS is computed lazily at read time, so it decays toward zero when the
// stream goes quiet instead of freezing at the last sample.
// ═══════════════════════════════════════════════════════════════════════════

const WINDOW_MS = 3000;
const COMPACTION_THRESHOLD = 5000;
const MIN_WINDOW_MS = 100;

class SlidingWindow {
  private events: { time: number; tokens: number }[] = [];
  private windowStartIndex = 0;

  record(tokens: number): void {
    if (tokens <= 0) return;
    this.events.push({ time: Date.now(), tokens });
    if (this.windowStartIndex >= COMPACTION_THRESHOLD) {
      this.compact();
    }
  }

  getTps(now: number): number {
    if (this.events.length === 0) return 0;
    const windowStart = now - WINDOW_MS;
    while (
      this.windowStartIndex < this.events.length &&
      this.events[this.windowStartIndex].time < windowStart
    ) {
      this.windowStartIndex++;
    }
    if (this.windowStartIndex >= this.events.length) return 0;

    let count = 0;
    for (let i = this.windowStartIndex; i < this.events.length; i++) {
      count += this.events[i].tokens;
    }
    if (count === 0) return 0;

    const rawSpan = now - this.events[this.windowStartIndex].time;
    const span = Math.max(rawSpan, MIN_WINDOW_MS);
    return (1000 * count) / span;
  }

  reset(): void {
    this.events.length = 0;
    this.windowStartIndex = 0;
  }

  private compact(): void {
    if (this.windowStartIndex === 0) return;
    this.events.splice(0, this.windowStartIndex);
    this.windowStartIndex = 0;
  }
}

export class TokenSpeedEngine {
  private _isStreaming = false;
  private _slidingWindow = new SlidingWindow();
  /** Last observed value of the provider's cumulative output token count. */
  private _anchor = 0;
  /** Whether the preferred (usage-based) counting source has been adopted. */
  private _prefActive = false;

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  /** Live tokens/sec over the trailing window; 0 when nothing was recent. */
  get tps(): number {
    return this._slidingWindow.getTps(Date.now());
  }

  /**
   * A content block started. Begins a fresh measurement when no message is
   * active; a no-op for additional blocks within the same message, so the
   * window and cumulative anchor survive block transitions.
   */
  beginBlock(): void {
    if (this._isStreaming) return;
    this._isStreaming = true;
    this._slidingWindow.reset();
    this._anchor = 0;
    this._prefActive = false;
  }

  /** The message ended (normally or via error). Clears all measurements. */
  end(): void {
    this._isStreaming = false;
    this._slidingWindow.reset();
    this._anchor = 0;
    this._prefActive = false;
  }

  recordDelta(_delta: string, usageOutput?: number): void {
    if (!this._isStreaming) return;

    if (usageOutput !== undefined && usageOutput > this._anchor) {
      this._prefActive = true;
      this._slidingWindow.record(usageOutput - this._anchor);
      this._anchor = usageOutput;
      return;
    }
    if (usageOutput !== undefined && usageOutput < this._anchor) {
      // Cumulative counter restarted lower than expected: a new message
      // began without an explicit terminator. Resync the baseline.
      this._slidingWindow.reset();
      this._anchor = usageOutput;
      this._prefActive = false;
      return;
    }
    if (this._prefActive) return; // Flat reading on an adopted scale: no progress
    this._slidingWindow.record(1); // Fallback until the preferred source proves itself
  }
}
