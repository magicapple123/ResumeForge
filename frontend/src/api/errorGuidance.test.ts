// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { errorGuidance, formatErrorGuidance } from "./errorGuidance";

describe("errorGuidance", () => {
  it("maps timeout errors to a retry-oriented action with request ref", () => {
    const guidance = errorGuidance(new ApiError("请求超时", undefined, { code: "timeout" }));
    expect(guidance.reason).toBe("请求等待超时");
    expect(guidance.action).toContain("重试");
    expect(guidance.ref).toBe("-");
  });

  it("maps network errors to a backend-check action", () => {
    const guidance = errorGuidance(new ApiError("网络错误", undefined, { code: "network" }));
    expect(guidance.reason).toBe("无法连接后端服务");
    expect(guidance.action).toContain("后端");
  });

  it("keeps the backend message as the reason for 409 conflicts", () => {
    const err = new ApiError("已有任务正在进行中", 409, { code: "http" });
    const guidance = errorGuidance(err);
    expect(guidance.reason).toBe("已有任务正在进行中");
    expect(guidance.action).toContain("停止或等待");
  });

  it("guides 5xx errors toward exporting diagnostics with the request id", () => {
    const err = new ApiError("服务器内部错误", 500, {
      code: "http",
      requestId: "abcdef1234567890",
    });
    const guidance = errorGuidance(err);
    expect(guidance.ref).toBe("abcdef12");
    expect(guidance.action).toContain("诊断包");
  });

  it("falls back to a generic guidance for non-ApiError values", () => {
    const guidance = errorGuidance(new Error("本地异常"));
    expect(guidance.reason).toBe("本地异常");
    expect(guidance.ref).toBe("-");
  });

  it("formatErrorGuidance composes reason, action and ref into one line", () => {
    const err = new ApiError("请求超时，请重试", undefined, {
      code: "timeout",
      requestId: "0123456789abcdef",
    });
    const text = formatErrorGuidance(err, "启动生成失败，请重试");
    expect(text).toBe(
      "原因：请求等待超时 · 建议：请重试；数据量大的导出/生成可稍后再试或调小范围 · 编号：01234567",
    );
  });
});
