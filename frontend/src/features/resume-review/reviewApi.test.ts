// SPDX-License-Identifier: Apache-2.0
/**
 * 批注 HTTP 适配层测试（契约 wave3 §4.5）：端点、方法、请求体形状与响应直通。
 *
 * 这一层是"前端契约 ↔ 后端契约"唯一的接缝；它写错时 UI 测试（mock adapter）全绿、
 * 真实环境 404/422——所以逐条钉住 URL 与 body。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
const requestRaw = vi.fn();
const getFilenameFromDisposition = vi.fn();

vi.mock("../../api/client", () => ({
  request: (...args: unknown[]) => request(...args),
  requestRaw: (...args: unknown[]) => requestRaw(...args),
  getFilenameFromDisposition: (...args: unknown[]) => getFilenameFromDisposition(...args),
}));

import { createReviewAnnotationApi } from "./reviewApi";
import type { ReviewAnnotationRecord } from "./types";

function record(id: number): ReviewAnnotationRecord {
  return {
    id,
    share_package_id: 7,
    resume_id: 3,
    document_version_id: null,
    snapshot_sha256: "a".repeat(64),
    external_id: `ext-${id}`,
    object_id: "ob_aaaaaaaaaaaa",
    point_id: null,
    path: null,
    field: null,
    quoted_text: "",
    text: "批注正文",
    reviewer: "李老师",
    status: "open",
    resolved_at: null,
    created_at: "2026-10-24T00:00:00Z",
  };
}

beforeEach(() => {
  request.mockReset();
  requestRaw.mockReset();
  getFilenameFromDisposition.mockReset();
});

describe("createReviewAnnotationApi", () => {
  it("GET /share-packages/{id}/annotations → items", async () => {
    request.mockResolvedValue({ items: [record(1)] });
    const api = createReviewAnnotationApi();
    await expect(api.list(7)).resolves.toEqual([record(1)]);
    expect(request).toHaveBeenCalledWith("/share-packages/7/annotations");
  });

  it("导入：POST /annotations/import，body={content}，走 upload 预算", async () => {
    const result = {
      imported: 1,
      duplicates: 0,
      stale: 0,
      dismissed_existing: 0,
      annotations: [record(1)],
    };
    request.mockResolvedValue(result);
    const api = createReviewAnnotationApi();
    const content = '{"format_version":1}';
    await expect(api.importAnnotations(7, content)).resolves.toEqual(result);
    expect(request).toHaveBeenCalledWith("/share-packages/7/annotations/import", {
      method: "POST",
      body: JSON.stringify({ content }),
      budget: "upload",
    });
  });

  it("状态动作：resolve / reopen / dismiss 各自的 POST 端点", async () => {
    request.mockResolvedValue(record(9));
    const api = createReviewAnnotationApi();
    await api.resolve(9);
    await api.reopen(9);
    await api.dismiss(9);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "/resume-annotations/9/resolve",
      "/resume-annotations/9/reopen",
      "/resume-annotations/9/dismiss",
    ]);
    for (const call of request.mock.calls) expect(call[1]).toEqual({ method: "POST" });
  });

  it("重新关联：POST /resume-annotations/{id}/reattach，body 带 object_id/point_id", async () => {
    request.mockResolvedValue(record(9));
    const api = createReviewAnnotationApi();
    await api.reattach(9, { object_id: "ob_aaaaaaaaaaaa", point_id: null });
    expect(request).toHaveBeenCalledWith("/resume-annotations/9/reattach", {
      method: "POST",
      body: JSON.stringify({ object_id: "ob_aaaaaaaaaaaa", point_id: null }),
    });
  });

  it("下载评审包：requestRaw + Content-Disposition 文件名（缺省回退）", async () => {
    const blob = new Blob(["zip"]);
    requestRaw.mockResolvedValue({
      blob: async () => blob,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="review.zip"' }),
    });
    getFilenameFromDisposition.mockReturnValue("review.zip");
    const api = createReviewAnnotationApi();
    await expect(api.downloadReviewPackage(7)).resolves.toEqual({ blob, filename: "review.zip" });
    expect(requestRaw).toHaveBeenCalledWith("/share-packages/7/review-package", {
      budget: "export",
    });

    requestRaw.mockResolvedValue({ blob: async () => blob, headers: new Headers() });
    getFilenameFromDisposition.mockReturnValue(null);
    await expect(api.downloadReviewPackage(7)).resolves.toEqual({
      blob,
      filename: "review-package.zip",
    });
  });
});
