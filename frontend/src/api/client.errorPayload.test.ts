// SPDX-License-Identifier: Apache-2.0
/**
 * W12-FE 接线缺口回归：非 2xx 的**结构化错误体**必须能被调用方拿到。
 *
 * 背景：事实锁 409 的响应体是 `{detail, code:"fact_lock_conflict", violations:[...]}`。
 * 传输层此前只把 `detail` 投影成 `message`、把 `code` 投影成 `businessCode`，逐条
 * `violations` 在读完正文后就丢了——界面只能给一句通用说明。`ApiError.payload` 保留
 * 解析后的响应体，让调用方能显示"哪几条事实被锁"。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiError";
import { request } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-test-1" },
  });
}

describe("ApiError.payload：结构化错误体不再丢失", () => {
  it("409 事实锁冲突保留 violations 与业务码", async () => {
    const body = {
      detail: "有 1 条事实被锁定，AI 修改已拒绝",
      code: "fact_lock_conflict",
      violations: [{ object_id: "obj_1234", field: "company", reason: "locked" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(body, 409)),
    );

    await expect(request("/resumes/1/revise")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      businessCode: "fact_lock_conflict",
      requestId: "req-test-1",
    });

    const error = await request("/resumes/1/revise").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.payload).toEqual(body);
    // 逐条违规必须可以安全地按结构读取（面板据此只读展示）。
    const violations = (apiError.payload as { violations?: { field: string }[] }).violations ?? [];
    expect(violations.map((item) => item.field)).toEqual(["company"]);
  });

  it("普通字符串 detail 也会带回原文（旧调用方不受影响）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { detail: "这份简历已被其他窗口修改", code: "resume_revision_conflict", revision: 7 },
          409,
        ),
      ),
    );
    const error = (await request("/resumes/1/content").catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error.message).toBe("这份简历已被其他窗口修改");
    expect(error.businessCode).toBe("resume_revision_conflict");
    expect(error.payload).toEqual({
      detail: "这份简历已被其他窗口修改",
      code: "resume_revision_conflict",
      revision: 7,
    });
  });
});
