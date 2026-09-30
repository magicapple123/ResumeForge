import { describe, expect, it } from "vitest";
import {
  CORE_NAVIGATION_KEYS,
  NAVIGATION_ITEMS,
  filterNavigationItems,
  pathMatchesNavigationItem,
} from "./navigationConfig";

describe("navigationConfig", () => {
  it("keeps core entries visible even when hidden settings contain their keys", () => {
    const visible = filterNavigationItems(NAVIGATION_ITEMS, ["/", "/jobs", "/assistant"], "/jobs");
    const keys = visible.map((item) => item.key);

    expect(CORE_NAVIGATION_KEYS.has("/jobs")).toBe(true);
    expect(keys).toContain("/");
    expect(keys).toContain("/jobs");
    expect(keys).not.toContain("/assistant");
  });

  it("keeps a hidden module reachable while it is already open", () => {
    const visible = filterNavigationItems(NAVIGATION_ITEMS, ["/assistant"], "/assistant/thread-1");
    expect(visible.map((item) => item.key)).toContain("/assistant");
    expect(
      pathMatchesNavigationItem(
        "/assistant/thread-1",
        NAVIGATION_ITEMS.find((item) => item.key === "/assistant")!,
      ),
    ).toBe(true);
  });
});
