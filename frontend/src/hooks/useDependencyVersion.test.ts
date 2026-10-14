import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDependencyVersion } from "./useDependencyVersion";

describe("useDependencyVersion", () => {
  it("does not reload for an equivalent new dependency array", () => {
    const shared = {};
    const { result, rerender } = renderHook(({ deps }) => useDependencyVersion(deps), {
      initialProps: { deps: [shared, NaN] as unknown[] },
    });
    rerender({ deps: [shared, NaN] });
    expect(result.current).toBe(0);
    rerender({ deps: [{}, NaN] });
    expect(result.current).toBe(1);
  });

  it("preserves Object.is signed-zero semantics and detects length changes", () => {
    const { result, rerender } = renderHook(({ deps }) => useDependencyVersion(deps), {
      initialProps: { deps: [0] },
    });
    rerender({ deps: [-0] });
    expect(result.current).toBe(1);
    rerender({ deps: [-0, 1] });
    expect(result.current).toBe(2);
    rerender({ deps: [] });
    expect(result.current).toBe(3);
  });
});
