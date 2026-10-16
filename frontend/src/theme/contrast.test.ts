import { describe, expect, it } from "vitest";
import { palette } from "./tokens";

function luminance(hex: string) {
  const values = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

describe("text color contrast", () => {
  const cases = [
    ["primary button", palette.surface, palette.brand],
    ["body", palette.textBody, palette.surface],
    ["secondary", palette.textSecondary, palette.surfaceAlt],
    ["caption", palette.textTertiary, palette.surfaceAlt],
    ["link", palette.link, palette.surface],
    ["success", palette.success, "#f6ffed"],
    ["warning", palette.warning, "#fffbe6"],
    ["error", palette.error, "#fff1f0"],
  ];

  it.each(cases)("%s remains readable on its intended surface", (_name, foreground, background) => {
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
