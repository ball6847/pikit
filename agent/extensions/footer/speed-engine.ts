// ═══════════════════════════════════════════════════════════════════════════
// Token Speed Engine
// Tracks streaming token generation in real-time using a sliding window.
// ═══════════════════════════════════════════════════════════════════════════

const TOKEN_REGEX = /\w+|[^\s\w]/g;
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
  private _tokenCount = 0;
  private _startTime = 0;
  private _endTime = 0;
  private _slidingWindow = new SlidingWindow();
  private _currentTps = 0;
  private _countedOutput = 0;

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  get tokenCount(): number {
    return this._tokenCount;
  }

  get tps(): number {
    return this._currentTps;
  }

  get elapsedSeconds(): number {
    if (this._startTime === 0) return 0;
    const end = this._isStreaming ? Date.now() : this._endTime;
    return (end - this._startTime) / 1000;
  }

  start(): void {
    if (this._isStreaming) return;
    this._tokenCount = 0;
    this._isStreaming = true;
    this._startTime = Date.now();
    this._endTime = Date.now();
    this._slidingWindow.reset();
    this._currentTps = 0;
    this._countedOutput = 0;
  }

  stop(): void {
    this._isStreaming = false;
    this._endTime = Date.now();
    this._slidingWindow.reset();
  }

  recordDelta(delta: string, usageOutput?: number): void {
    if (!this._isStreaming) return;

    // Prefer provider-reported cumulative output token count
    if (usageOutput !== undefined && usageOutput > this._countedOutput) {
      const deltaTokens = usageOutput - this._countedOutput;
      this._recordTokens(deltaTokens);
      this._countedOutput = usageOutput;
      return;
    }

    // Fallback: count 1 token per delta event
    this._recordTokens(1);
  }

  reconcileTotal(tokens: number): void {
    if (tokens > 0) this._tokenCount = tokens;
  }

  private _recordTokens(tokens: number): void {
    if (!this._isStreaming || tokens <= 0) return;
    this._tokenCount += tokens;
    this._slidingWindow.record(tokens);
    this._currentTps = this._slidingWindow.getTps(Date.now());
  }
}
