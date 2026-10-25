// SPDX-License-Identifier: Apache-2.0
/** W12 关联请求构造：只带 source_id、目标定位去空、修订可选。 */
import { describe, expect, it } from "vitest";
import { buildSourceLinkRequest, hasLinkTarget, targetLabel } from "./linkInput";

describe("buildSourceLinkRequest", () => {
  it("带上 resume_id/source_id 与目标块定位", () => {
    expect(
      buildSourceLinkRequest(5, 9, {
        object_id: "exp_1",
        point_id: "pt_1",
        path: "experience.0.description.0",
        field: "description",
      }),
    ).toEqual({
      resume_id: 5,
      source_id: 9,
      object_id: "exp_1",
      point_id: "pt_1",
      path: "experience.0.description.0",
      field: "description",
    });
  });

  it("空定位字段不发给后端；可选修订只在正整数时带上", () => {
    const request = buildSourceLinkRequest(5, 9, { object_id: "exp_1", path: "", field: null }, 0);
    expect(request).toEqual({ resume_id: 5, source_id: 9, object_id: "exp_1" });
    expect(buildSourceLinkRequest(5, 9, { path: "summary" }, 12).source_revision_id).toBe(12);
  });
});

describe("hasLinkTarget / targetLabel", () => {
  it("任一定位存在即可提交", () => {
    expect(hasLinkTarget(null)).toBe(false);
    expect(hasLinkTarget({})).toBe(false);
    expect(hasLinkTarget({ path: "summary" })).toBe(true);
    expect(hasLinkTarget({ point_id: "pt_1" })).toBe(true);
  });

  it("展示优先 path，其次稳定 id", () => {
    expect(targetLabel({ path: "experience.0", object_id: "exp_1" })).toBe("experience.0");
    expect(targetLabel({ object_id: "exp_1" })).toBe("exp_1");
    expect(targetLabel(null)).toBe("");
  });
});
