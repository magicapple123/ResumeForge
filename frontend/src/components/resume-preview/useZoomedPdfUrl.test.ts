// SPDX-License-Identifier: Apache-2.0
/**
 * Q18: the zoomed PDF objectURL must be created in an effect, not during render.
 * StrictMode's mount → cleanup → mount cycle revoke a URL created by useMemo and leaves a
 * blank viewer; the contract here is: create in the effect timer, keep it in the panel
 * registry, release only the previous URL created by this hook.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useZoomedPdfUrl } from "./useZoomedPdfUrl";

const created: string[] = [];
const revoked: string[] = [];
let counter = 0;

const SHOT = { url: "blob:shot", blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }) };

const keep = (url: string) => {
  return url;
};
const release = vi.fn((url: string | null) => {
  if (url) revoked.push(url.split("#")[0]);
});

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  counter = 0;
  release.mockClear();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      counter += 1;
      const url = `blob:zoom-${counter}`;
      created.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  vi.useRealTimers();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("useZoomedPdfUrl", () => {
  it("creates nothing during render; the URL appears after the effect timer", async () => {
    const { result, rerender } = renderHook(
      ({ pct }: { pct: number | null }) => useZoomedPdfUrl(SHOT, pct, keep, release),
      { initialProps: { pct: 100 as number | null } },
    );
    // Render pass alone must not touch the browser URL factory.
    expect(created).toEqual([]);
    await settle();
    expect(created).toHaveLength(1);
    expect(result.current).toBe("blob:zoom-1#zoom=100&toolbar=0&navpanes=0");
    rerender({ pct: 120 });
    await settle();
    expect(created).toHaveLength(2);
    // The previous zoom URL is released when the next one takes over...
    expect(revoked).toContain("blob:zoom-1");
    // ...but the shot's own URL (used by "open in new tab") is never released by this hook.
    expect(revoked).not.toContain("blob:shot");
  });

  it("returns null and releases the previous URL when unzoomed", async () => {
    const { result, rerender } = renderHook(
      ({ pct }: { pct: number | null }) => useZoomedPdfUrl(SHOT, pct, keep, release),
      { initialProps: { pct: 120 as number | null } },
    );
    await settle();
    expect(result.current).not.toBeNull();
    rerender({ pct: null });
    await settle();
    expect(result.current).toBeNull();
    expect(revoked).toContain("blob:zoom-1");
  });
});
