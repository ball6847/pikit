import type { RenderedSegment, SegmentContext } from "../types.js";
import { fg } from "../theme.js";

function lbl(ctx: SegmentContext, text: string): string {
  return fg(ctx.theme, "dim", text);
}

/** Map TPS value → 24-bit ANSI color based on speed thresholds */
function tpsColorHex(tps: number): string | null {
  if (tps >= 80) return "#ff6b6b";   // blazing
  if (tps >= 40) return "#ffd93d";   // fast
  if (tps >= 15) return "#6bcb77";   // medium
  if (tps >= 5)  return "#4d96ff";   // slow
  if (tps > 0)   return "#9e9e9e";   // very slow
  return null;
}

function applyTpsColor(text: string, tps: number): string {
  const hex = tpsColorHex(tps);
  if (!hex) return text;
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return text;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export const tokenSpeedSegment = {
  id: "token_speed" as const,
  render(ctx: SegmentContext): RenderedSegment {
    const tps = ctx.tokenSpeedTps;

    if (!ctx.tokenSpeedIsStreaming && tps <= 0) {
      return { content: "", visible: false };
    }

    const value = tps > 0 ? tps.toFixed(1) : "--";
    const unit = "tok/s";
    const coloredValue = applyTpsColor(value, tps);

    const icon = "⚡";
    const content = lbl(ctx, icon) + " " + coloredValue + " " + lbl(ctx, unit);

    return { content, visible: true };
  },
};
