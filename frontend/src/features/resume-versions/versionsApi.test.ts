// SPDX-License-Identifier: Apache-2.0
/** W13 接口接线：URL/方法/请求体 + 409 冲突可读（真实端点契约，不 mock 业务实现）。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import {
  compareVersions,
  createVersion,
  freezeVersion,
  restoreVersion,
  syncVariants,
} from "./versionsApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

describe("W13 versions/variants API", () => {
  it("创建版本：POST /resumes/{id}/versions，body 带 name/change_summary", async () => {
    const calls = stubFetch({ id: 3 });
    await createVersion(7, { name: "终稿", change_summary: "投递用" });
    expect(calls[0].url).toContain("/resumes/7/versions");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      name: "终稿",
      change_summary: "投递用",
    });
  });

  it("对比：against 支持版本 id 与 current", async () => {
    const calls = stubFetch({ base_id: 1 });
    await compareVersions(7, 5, "current");
    expect(calls[0].url).toContain("/resumes/7/versions/5/compare/current");
    await compareVersions(7, 5, 9);
    expect(calls[1].url).toContain("/resumes/7/versions/5/compare/9");
  });

  it("恢复：带 expected_revision 条件写；不传时不伪造字段", async () => {
    const calls = stubFetch({ revision: 9 });
    await restoreVersion(7, 3, 8);
    expect(calls[0].url).toContain("/resumes/7/versions/3/restore");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ expected_revision: 8 });
    await restoreVersion(7, 3);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({});
  });

  it("冻结与变体同步的请求体直传契约字段", async () => {
    const calls = stubFetch({});
    await freezeVersion(7, 3, true);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ frozen: true });
    await syncVariants(7, { source_version_id: 2, variant_ids: [1], paths: ["summary"] });
    expect(calls[1].url).toContain("/resumes/7/variants/sync");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      source_version_id: 2,
      variant_ids: [1],
      paths: ["summary"],
    });
  });

  it("409 冲突：businessCode 与结构化 body 可读（不自动重试覆盖）", async () => {
    stubFetch({ detail: "版本已过期", code: "resume_revision_conflict", revision: 12 }, 409);
    await expect(restoreVersion(7, 3, 1)).rejects.toMatchObject({
      businessCode: "resume_revision_conflict",
      message: "版本已过期",
    });
    await expect(restoreVersion(7, 3, 1)).rejects.toBeInstanceOf(ApiError);
  });
});
