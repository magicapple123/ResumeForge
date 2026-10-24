// SPDX-License-Identifier: Apache-2.0
/**
 * `previewResumeTemplate` 的请求体：**绝不能**把 `signal` 一起序列化进去。
 *
 * 回归背景（2026-10，用户报「模板选择弹窗里所有缩略图都报 Extra inputs are not
 * permitted」）：`payload` 里带着 `signal?: AbortSignal`，而 `JSON.stringify` 会把
 * AbortSignal 序列化成 `{}`，于是请求体多了 `"signal": {}`。后端
 * `TemplatePreviewRequest` 是 `extra="forbid"`，直接 422，前端只显示 Pydantic 的英文
 * 提示；而「查看大图」那条路径不传 signal，所以它一直正常——现象差异正来自这里。
 *
 * 两件事必须同时成立：请求体里没有 `signal`，且取消信号仍然传到 `fetch`（换字号 /
 * 关弹窗时还要能掐掉在飞的渲染）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewResumeTemplate } from "./resumes";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("previewResumeTemplate", () => {
  it("请求体里不含 signal，而取消信号仍然传给 fetch", async () => {
    let release: (() => void) | undefined;
    // 直接记下 fetch 实际收到的 URL 与 RequestInit：既避免再回读 mock.calls 的类型体操，
    // 也让"参数真的被用到了"一眼可见。
    let capturedUrl = "";
    let captured: RequestInit | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      capturedUrl = url;
      captured = init;
      return new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            new Response("<html><body>示例</body></html>", {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
          );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const pending = previewResumeTemplate({
      template_name: "classic",
      format_name: "standard",
      font_scale: "small",
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = captured ?? {};
    expect(capturedUrl).toContain("/api/resume-templates/preview");

    // 1) 请求体里没有 `signal`（否则后端 422 "Extra inputs are not permitted"）。
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("signal");
    // 2) 该带的字段一个不少。
    expect(body).toMatchObject({
      template_name: "classic",
      format_name: "standard",
      font_scale: "small",
    });

    // 3) 取消信号仍然链到 fetch：调用方 abort 时这条请求必须跟着中止。
    const forwarded = init.signal as AbortSignal;
    expect(forwarded).toBeInstanceOf(AbortSignal);
    expect(forwarded.aborted).toBe(false);
    controller.abort();
    expect(forwarded.aborted).toBe(true);

    // 4) 取消之后**正文读取**也必须被中断（A03）。以前 abort 只掐 fetch：响应头一旦到达，
    //    这块正文照样被读完——关掉弹窗后仍在解析整页 HTML。这里的 fetch mock 在被 abort
    //    之后依然会 resolve 出响应，正好用来钉住"读取阶段同样受控"。
    release?.();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("未取消时正文照常读完（取消只影响被取消的那一条）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>示例</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const controller = new AbortController();

    await expect(
      previewResumeTemplate({ template_name: "classic", signal: controller.signal }),
    ).resolves.toContain("示例");
  });
});
