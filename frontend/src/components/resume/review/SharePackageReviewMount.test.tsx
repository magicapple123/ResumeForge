// SPDX-License-Identifier: Apache-2.0
/**
 * W18-FE 挂载测试：`SharePackageModal` 生成「可评论」分享包后出现对象批注面板。
 *
 * 只验证**挂载与接线**（section 出现、mock 接口被调用、定位回调带上路径），
 * 面板自身的状态机/导入/错误态在 `ReviewAnnotationsPanel.test.tsx` 里覆盖。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ReviewAnnotationRecord } from "../../../features/resume-review";
import SharePackageModal from "../../SharePackageModal";

const ANNOTATION_TEXT = "导出前请核对量化结果";

const data = vi.hoisted(() => ({
  annotation: {
    id: 1,
    share_package_id: 7,
    resume_id: 3,
    document_version_id: null,
    snapshot_sha256: "a".repeat(64),
    external_id: "ext-001",
    object_id: "ob_aaaaaaaaaaaa",
    point_id: null,
    path: null,
    field: null,
    quoted_text: "",
    text: "导出前请核对量化结果",
    reviewer: "李老师",
    status: "open",
    resolved_at: null,
    created_at: "2026-10-24T10:00:00Z",
  } as const,
  detail: {
    id: 7,
    title: "张三-分享包",
    resume_id: 3,
    job_id: null,
    permission: "comment",
    files: [
      {
        name: "resume.html",
        path: "/tmp/share_packages/7/resume.html",
        format: "html",
        size: 128,
        sha256: "b".repeat(64),
        download_url: "",
      },
    ],
    // 对象锚点要能在快照里解析：给一个带稳定 id 的项目条目。
    snapshot: {
      name: "张三",
      projects: [
        {
          id: "ob_aaaaaaaaaaaa",
          name: "项目甲",
          role: "",
          description: ["甲一"],
          tech_stack: [],
          highlights: [],
        },
      ],
    },
    comments_file: "",
    share_token: "0123456789abcdef0123456789abcdef",
    redaction_config: {},
    created_at: "2026-10-24T10:00:00Z",
    updated_at: "2026-10-24T10:00:00Z",
  },
}));

const holder = vi.hoisted(() => ({ reviewApi: null as unknown }));

vi.mock("../../../features/resume-review/reviewApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../features/resume-review/reviewApi")>();
  holder.reviewApi = actual.createMockReviewAnnotationApi({
    initial: [data.annotation as unknown as ReviewAnnotationRecord],
  });
  return { ...actual, createReviewAnnotationApi: () => holder.reviewApi };
});

vi.mock("../../../api/sharePackages", () => ({
  createSharePackage: vi.fn(),
  deleteSharePackage: vi.fn(async () => undefined),
  downloadSharePackageFile: vi.fn(),
  getSharePackageComments: vi.fn(async () => ({
    filename: "comments.md",
    format: "markdown",
    content: "",
  })),
  importSharePackageComments: vi.fn(),
  revealSharePackage: vi.fn(),
  listSharePackages: vi.fn(async () => []),
}));

vi.mock("../../../api/resumes", () => ({
  downloadResumeShareZip: vi.fn(async () => ({ blob: new Blob(["zip"]), filename: "share.zip" })),
}));

import { createSharePackage } from "../../../api/sharePackages";

function renderModal(onLocateAnnotation?: (path: string) => void) {
  return render(
    <AntdApp>
      <SharePackageModal
        recordId={3}
        open
        onClose={() => undefined}
        onLocateAnnotation={onLocateAnnotation}
      />
    </AntdApp>,
  );
}

async function generateSharePackage(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /生成分享包/ }));
  await waitFor(() => expect(screen.getByText(t("review.panel.title"))).toBeInTheDocument());
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.mocked(createSharePackage).mockReset();
});

describe("SharePackageModal × 对象批注挂载", () => {
  it("可评论分享包生成后出现批注区，并调用批注列表接口", async () => {
    vi.mocked(createSharePackage).mockResolvedValue(data.detail as never);
    const reviewApi = holder.reviewApi as { calls: string[] };
    renderModal();
    await generateSharePackage();
    expect(await screen.findByText(ANNOTATION_TEXT)).toBeInTheDocument();
    expect(reviewApi.calls).toContain("list");
  });

  it("定位按钮把当前对象 path 交给宿主（onLocateAnnotation）", async () => {
    vi.mocked(createSharePackage).mockResolvedValue(data.detail as never);
    const onLocate = vi.fn();
    renderModal(onLocate);
    await generateSharePackage();
    await screen.findByText(ANNOTATION_TEXT);
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("review.action.locate").split("").join("\\s*")),
      }),
    );
    expect(onLocate).toHaveBeenCalledWith("projects.0");
  });

  it("只读权限分享包不渲染批注区（没有回传入口）", async () => {
    vi.mocked(createSharePackage).mockResolvedValue({
      ...data.detail,
      permission: "read_only",
    } as never);
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /生成分享包/ }));
    // 只等"生成请求完成"这个事实，不按中文文案找节点（cjkRatchet 的 tests 口径）。
    await waitFor(() => expect(createSharePackage).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(t("review.panel.title"))).toBeNull());
  });
});
