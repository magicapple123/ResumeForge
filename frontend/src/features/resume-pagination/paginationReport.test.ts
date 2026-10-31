// SPDX-License-Identifier: Apache-2.0
/** 分页报告：容错解析、截断定位目标、请求体走 `export` 预算。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  request: clientMocks.request,
}));

import {
  fetchPaginationReport,
  manualBreakLocateTarget,
  parsePaginationReport,
  truncationLocateTarget,
} from "./paginationReport";
import type { ResumeDocument } from "../../types/resumeDocument";

const V2_DOCUMENT: ResumeDocument = {
  version: 2,
  language: "zh-CN",
  header: { items: [], contact_breaks: [] },
  sections: [
    {
      key: "projects",
      title: "项目",
      kind: "entries",
      layout: {
        columns: 1,
        align: "equal",
        gap: null,
        hide_title: false,
        keep_together: false,
        start_on_new_page: false,
        title_override: "",
      },
      entries: [],
    },
  ],
};

const RAW = {
  pages: 2,
  pages_needed: 3,
  page_limit: 2,
  overflow: true,
  truncated_at: {
    kind: "entry",
    section: "projects",
    object_id: "prj_12345678",
    point_index: null,
    text_preview: "主导…",
  },
  manual_breaks: [{ kind: "entry", object_id: "exp_12345678", section: "experience", page: 2 }],
  warnings: [{ code: "repeat_name_no_room", detail: "上边距不足 8mm" }],
  snapshot: { content_sha256: "c1", render_config_sha256: "r1" },
};

beforeEach(() => {
  clientMocks.request.mockReset();
});

describe("parsePaginationReport", () => {
  it("解析完整响应（含快照指纹）", () => {
    expect(parsePaginationReport(RAW)).toEqual({
      pages: 2,
      pagesNeeded: 3,
      pageLimit: 2,
      overflow: true,
      lastPageFill: null,
      truncatedAt: {
        kind: "entry",
        section: "projects",
        objectId: "prj_12345678",
        pointIndex: null,
        textPreview: "主导…",
      },
      manualBreaks: [{ kind: "entry", section: "experience", objectId: "exp_12345678", page: 2 }],
      warnings: [{ code: "repeat_name_no_room", detail: "上边距不足 8mm" }],
      contentSha256: "c1",
      renderConfigSha256: "r1",
    });
  });

  it("字段缺失/类型错误不崩：数值为空、列表为空", () => {
    const report = parsePaginationReport({ overflow: "yes", pages: "3" });
    expect(report).not.toBeNull();
    expect(report?.pages).toBeNull();
    expect(report?.overflow).toBe(false);
    expect(report?.truncatedAt).toBeNull();
    expect(report?.manualBreaks).toEqual([]);
    expect(report?.warnings).toEqual([]);
  });

  it("非对象返回 null（界面显示还没有报告）", () => {
    expect(parsePaginationReport(null)).toBeNull();
    expect(parsePaginationReport("x")).toBeNull();
  });
});

describe("定位目标", () => {
  it("截断优先对象 id，其次板块；都没有返回 null", () => {
    const report = parsePaginationReport(RAW);
    expect(truncationLocateTarget(report)).toEqual({
      objectId: "prj_12345678",
      section: "projects",
    });
    expect(
      truncationLocateTarget(
        parsePaginationReport({ truncated_at: { kind: "section", section: "skills" } }),
      ),
    ).toEqual({ section: "skills" });
    expect(truncationLocateTarget(parsePaginationReport({}))).toBeNull();
  });

  it("手动断页目标带页号（供宿主翻页并定位）", () => {
    const report = parsePaginationReport(RAW);
    expect(manualBreakLocateTarget(report!.manualBreaks[0])).toEqual({
      objectId: "exp_12345678",
      section: "experience",
      page: 2,
    });
    expect(
      manualBreakLocateTarget({ kind: "entry", section: null, objectId: null, page: null }),
    ).toBeNull();
  });
});

describe("真实端点形状（W08-BE task-12 done）", () => {
  // 形状逐字来自 backend/app/services/resume/document_pagination.py 的返回字典
  // （report 端点 tests/test_pagination_report.py 已断言同一组字段）。
  const BACKEND_SHAPE = {
    pages: 1,
    pages_needed: 2,
    overflow: true,
    page_limit: 1,
    truncated_at: {
      kind: "entry",
      section: "experience",
      object_id: "exp_12345678",
      point_index: null,
      text_preview: "主导支付链路重构",
    },
    manual_breaks: [
      { kind: "entry", object_id: "exp_12345678", page: 2 },
      { kind: "section", section: "projects", page: 2 },
    ],
    warnings: [{ code: "repeat_name_no_room", detail: "上边距 6mm 小于 8mm，续页姓名未绘制" }],
    snapshot: { content_sha256: "a".repeat(64), render_config_sha256: "b".repeat(64) },
  };

  it("解析后端真实形状，并能给两类手动断页各出定位目标", () => {
    const report = parsePaginationReport(BACKEND_SHAPE);
    expect(report).not.toBeNull();
    expect(report?.pages).toBe(1);
    expect(report?.pagesNeeded).toBe(2);
    expect(report?.overflow).toBe(true);
    expect(report?.truncatedAt?.textPreview).toBe("主导支付链路重构");
    expect(truncationLocateTarget(report)).toEqual({
      objectId: "exp_12345678",
      section: "experience",
    });
    expect(manualBreakLocateTarget(report!.manualBreaks[0])).toEqual({
      objectId: "exp_12345678",
      page: 2,
    });
    expect(manualBreakLocateTarget(report!.manualBreaks[1])).toEqual({
      section: "projects",
      page: 2,
    });
    expect(report?.warnings[0]?.code).toBe("repeat_name_no_room");
  });
});

describe("fetchPaginationReport", () => {
  it("走 pagination/report 端点、export 预算，并把未保存正文放进请求体", async () => {
    clientMocks.request.mockResolvedValue(RAW);
    const controller = new AbortController();
    const report = await fetchPaginationReport(
      7,
      { template: "classic", page_limit: 2, content: V2_DOCUMENT },
      controller.signal,
    );
    expect(report.pagesNeeded).toBe(3);
    expect(clientMocks.request).toHaveBeenCalledWith(
      "/resumes/7/pagination/report",
      expect.objectContaining({ method: "POST", budget: "export", signal: controller.signal }),
    );
    const body = JSON.parse(
      (clientMocks.request.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({ template: "classic", page_limit: 2 });
    expect(body.content).toEqual(V2_DOCUMENT);
  });

  it("响应不可解析时抛错（不把空报告当成功）", async () => {
    clientMocks.request.mockResolvedValue("nope");
    await expect(fetchPaginationReport(7, {})).rejects.toThrow();
  });
});
