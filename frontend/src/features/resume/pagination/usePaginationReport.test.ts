// SPDX-License-Identifier: Apache-2.0
/** W08 报告取数：手动触发、单飞、取消、换简历清空、失败如实。 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parsePaginationReport } from "./paginationReport";
import { usePaginationReport } from "./usePaginationReport";

const REPORT = parsePaginationReport({
  pages: 2,
  pages_needed: 3,
  page_limit: 2,
  overflow: true,
  truncated_at: { kind: "entry", object_id: "exp_12345678", text_preview: "x" },
  manual_breaks: [],
  warnings: [],
  snapshot: { content_sha256: "c1", render_config_sha256: "r1" },
});

function setup(fetcher: ReturnType<typeof vi.fn>, resumeId: number | null = 7) {
  return renderHook(
    ({ id }: { id: number | null }) =>
      usePaginationReport({
        resumeId: id,
        buildRequest: () => ({ template: "classic" }),
        fetcher: fetcher as never,
      }),
    { initialProps: { id: resumeId } },
  );
}

describe("usePaginationReport", () => {
  it("手动触发一次、成功后给出报告", async () => {
    const fetcher = vi.fn(async () => REPORT!);
    const { result } = setup(fetcher);
    expect(result.current.status).toBe("idle");
    await act(async () => {
      await result.current.run();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.report?.pagesNeeded).toBe(3);
  });

  it("在飞时再点不排队（单飞）", async () => {
    let release: (value: unknown) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = setup(fetcher);
    await act(async () => {
      void result.current.run();
      void result.current.run();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(REPORT);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("失败如实进 error（不把空报告当成功）", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = setup(fetcher);
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.report).toBeNull();
  });

  it("没有简历 id 时不发请求", async () => {
    const fetcher = vi.fn(async () => REPORT!);
    const { result } = setup(fetcher, null);
    await act(async () => {
      await result.current.run();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("换简历清空旧报告（避免旧页数留在新版面）", async () => {
    const fetcher = vi.fn(async () => REPORT!);
    const { result, rerender } = setup(fetcher);
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.status).toBe("ready");
    rerender({ id: 8 });
    expect(result.current.report).toBeNull();
    expect(result.current.status).toBe("idle");
  });
});
