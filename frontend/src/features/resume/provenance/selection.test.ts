// SPDX-License-Identifier: Apache-2.0
/** 选择 → 定位适配层：大纲/纸面两种入口的映射、稳定键与空判定。 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LOCATOR,
  candidatePathFromSelection,
  isEmptyLocator,
  isSameLocator,
  locatorFromPath,
  locatorFromSelection,
  locatorKey,
  locatorWithCandidatePath,
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

const CONTENT = {
  experience: [
    {
      id: "exp_1",
      company: "Cloud",
      description: ["First bullet.", "Second bullet."],
      point_ids: { description: ["pt_1", "pt_2"] },
    },
  ],
  summary: "A summary.",
};

describe("candidatePathFromSelection（W12 局部写作候选）", () => {
  it("要点选择用 object_id/point_id 现算路径，不按数组下标猜", () => {
    const result = candidatePathFromSelection(
      {
        kind: "point",
        field: "experience",
        objectId: "exp_1",
        pointField: "description",
        pointId: "pt_2",
      },
      CONTENT,
    );
    expect(result).toEqual({ path: "experience.0.description.1", reason: "ok" });
  });

  it("条目级选择返回 not-a-point（一条条目有多个字段，不能替用户挑）", () => {
    expect(
      candidatePathFromSelection(
        { kind: "entry", field: "experience", objectId: "exp_1" },
        CONTENT,
      ),
    ).toEqual({ path: null, reason: "not-a-point" });
  });

  it("要点 id 在当前内容里找不到 → not-found（不猜）", () => {
    expect(
      candidatePathFromSelection(
        {
          kind: "point",
          field: "experience",
          objectId: "exp_1",
          pointField: "description",
          pointId: "pt_missing",
        },
        CONTENT,
      ),
    ).toEqual({ path: null, reason: "not-found" });
  });

  it("显式 path 只在指向字符串时接受（纸面/fe-outline 新契约）", () => {
    expect(candidatePathFromSelection({ kind: "entry", path: "summary" }, CONTENT)).toEqual({
      path: "summary",
      reason: "ok",
    });
    expect(candidatePathFromSelection({ kind: "entry", path: "experience" }, CONTENT)).toEqual({
      path: null,
      reason: "not-found",
    });
  });

  it("locatorWithCandidatePath 把现算 path 补进 locator", () => {
    const locator = locatorWithCandidatePath(
      {
        kind: "point",
        field: "experience",
        objectId: "exp_1",
        pointField: "description",
        pointId: "pt_1",
      },
      CONTENT,
    );
    expect(locator.object_id).toBe("exp_1");
    expect(locator.point_id).toBe("pt_1");
    expect(locator.path).toBe("experience.0.description.0");
  });
});
