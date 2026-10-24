// SPDX-License-Identifier: Apache-2.0
/** 选择 → 定位适配层：大纲/纸面两种入口的映射、稳定键与空判定。 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LOCATOR,
  isEmptyLocator,
  isSameLocator,
  locatorFromPath,
  locatorFromSelection,
  locatorKey,
} from "./selection";

describe("locatorFromSelection", () => {
  it("条目选择只带 object_id，不带路径（路径由服务端现算）", () => {
    expect(locatorFromSelection({ kind: "entry", field: "experience", objectId: "exp_1" })).toEqual(
      { object_id: "exp_1", point_id: null, path: null, label: undefined },
    );
  });

  it("要点选择同时带 object_id 与 point_id", () => {
    const locator = locatorFromSelection({
      kind: "point",
      field: "experience",
      objectId: "exp_1",
      pointField: "description",
      pointId: "pt_1",
    });
    expect(locator.object_id).toBe("exp_1");
    expect(locator.point_id).toBe("pt_1");
  });

  it("个人信息与空选择都返回空定位", () => {
    expect(locatorFromSelection({ kind: "personal" })).toEqual(EMPTY_LOCATOR);
    expect(locatorFromSelection(null)).toEqual(EMPTY_LOCATOR);
    expect(locatorFromSelection(undefined)).toEqual(EMPTY_LOCATOR);
  });

  it("显式 path 会保留（纸面点击与大岗选择混合时）", () => {
    expect(
      locatorFromSelection({ kind: "entry", objectId: "exp_1", path: "experience.0.company" }).path,
    ).toBe("experience.0.company");
  });

  it("label 透传，空串不保留", () => {
    expect(locatorFromSelection({ kind: "entry", objectId: "a", label: "本条" }).label).toBe(
      "本条",
    );
    expect(locatorFromSelection({ kind: "entry", objectId: "a", label: "" }).label).toBeUndefined();
  });
});

describe("locatorFromPath", () => {
  it("纸面点击只给 path", () => {
    expect(locatorFromPath("projects.0.highlights.1")).toEqual({
      object_id: null,
      point_id: null,
      path: "projects.0.highlights.1",
      label: undefined,
    });
  });

  it("空/非字符串路径返回空定位", () => {
    expect(locatorFromPath("")).toEqual(EMPTY_LOCATOR);
    expect(locatorFromPath(null)).toEqual(EMPTY_LOCATOR);
  });
});

describe("locatorKey / isEmptyLocator / isSameLocator", () => {
  it("键稳定且区分三种定位", () => {
    const a = locatorFromSelection({ kind: "entry", objectId: "x" });
    const b = locatorFromSelection({ kind: "entry", objectId: "x" });
    const c = locatorFromPath("experience.0.company");
    expect(locatorKey(a)).toBe(locatorKey(b));
    expect(locatorKey(a)).not.toBe(locatorKey(c));
    expect(isSameLocator(a, b)).toBe(true);
    expect(isSameLocator(a, c)).toBe(false);
  });

  it("空定位判定", () => {
    expect(isEmptyLocator(EMPTY_LOCATOR)).toBe(true);
    expect(isEmptyLocator(locatorFromPath("summary"))).toBe(false);
    expect(isEmptyLocator(null)).toBe(true);
  });

  it("键不受 label 影响（换标签不该触发重查）", () => {
    const a = { object_id: "x", point_id: null, path: null, label: "旧" };
    const b = { object_id: "x", point_id: null, path: null, label: "新" };
    expect(locatorKey(a)).toBe(locatorKey(b));
  });
});
