import { describe, expect, it } from "vitest";
import { INTERVIEWER_STYLES } from "../../types";
import {
  JANE_FACE_SOURCES,
  JANE_STYLE_FACE,
  janeFaceForScore,
  janeFaceForStyle,
} from "./janeFaces";

describe("janeFaces", () => {
  it("六种表情素材 key 齐全且互不重复", () => {
    expect(Object.keys(JANE_FACE_SOURCES).sort()).toEqual([
      "encourage",
      "idle",
      "note",
      "questioning",
      "strict",
      "thinking",
    ]);
  });

  it("素材表每项都指向同目录资产（webp 路径可解析）", () => {
    for (const src of Object.values(JANE_FACE_SOURCES)) {
      expect(typeof src).toBe("string");
      expect(src.length).toBeGreaterThan(0);
    }
  });

  it("四种面试官风格都有默认表情映射（钉住 INTERVIEWER_STYLES 白名单）", () => {
    for (const style of INTERVIEWER_STYLES) {
      expect(JANE_STYLE_FACE[style]).toBeTruthy();
    }
  });

  it("已知风格返回映射表情", () => {
    expect(janeFaceForStyle("严谨专业")).toBe("idle");
    expect(janeFaceForStyle("温和引导")).toBe("encourage");
    expect(janeFaceForStyle("持续追问")).toBe("questioning");
    expect(janeFaceForStyle("压力质询")).toBe("strict");
  });

  it("未知/缺失风格回退 idle", () => {
    expect(janeFaceForStyle(undefined)).toBe("idle");
    expect(janeFaceForStyle("自定义人设风格")).toBe("idle");
  });

  it("评分报告表情按 0-100 分三档联动", () => {
    expect(janeFaceForScore(85)).toBe("encourage");
    expect(janeFaceForScore(80)).toBe("encourage");
    expect(janeFaceForScore(79)).toBe("idle");
    expect(janeFaceForScore(60)).toBe("idle");
    expect(janeFaceForScore(59)).toBe("strict");
    expect(janeFaceForScore(5)).toBe("strict");
  });

  it("评分缺失/异常时保持平和，不替用户下结论", () => {
    expect(janeFaceForScore(undefined)).toBe("idle");
    expect(janeFaceForScore(Number.NaN)).toBe("idle");
  });
});
