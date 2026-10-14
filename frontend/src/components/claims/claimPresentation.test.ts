import { describe, expect, it } from "vitest";
import { claimResponsibilityColor, claimStatusColor } from "./claimPresentation";

describe("claim presentation colors", () => {
  it("keeps known verification and responsibility colors consistent", () => {
    expect(claimStatusColor("已确认")).toBe("green");
    expect(claimStatusColor("待确认")).toBe("gold");
    expect(claimResponsibilityColor("负责模块")).toBe("blue");
    expect(claimResponsibilityColor("项目负责人")).toBe("magenta");
  });

  it("unknown and inherited keys cannot become non-string color props", () => {
    for (const value of ["__proto__", "constructor", "toString", "自定义角色"]) {
      expect(claimStatusColor(value)).toBe("default");
      expect(claimResponsibilityColor(value)).toBe("default");
    }
  });
});
