// SPDX-License-Identifier: Apache-2.0
/**
 * W19 挂载测试：`DeliveryArchiveModal` 传入 resumeId 时，在历史存档下方显示"这份简历的
 * 交付原件"（ArchiveList）；不传 resumeId 时行为与之前逐字相同（全局存档页不显示原件区）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { createMockExportDeliveryApi } from "../../../features/resume-delivery";
import DeliveryArchiveModal from "../DeliveryArchiveModal";

vi.mock("../../../api/resumes", () => ({
  listDeliveryArchive: vi.fn(async () => ({ items: [], total: 0 })),
  downloadDelivery: vi.fn(),
}));

const ARTIFACT_FILENAME = "张三-后端工程师-20261024.pdf";

function mockArchiveApi() {
  return createMockExportDeliveryApi({
    artifacts: [
      {
        id: 1,
        delivery_id: null,
        resume_id: 3,
        kind: "bundle_member",
        export_format: "pdf",
        filename: ARTIFACT_FILENAME,
        media_type: "application/pdf",
        size_bytes: 2048,
        sha256: "d".repeat(64),
        resource_manifest: {},
        created_at: "2026-10-24T00:00:00Z",
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("DeliveryArchiveModal × 交付原件挂载", () => {
  it("传 resumeId：显示这份简历的归档原件", async () => {
    const api = mockArchiveApi();
    render(
      <AntdApp>
        <DeliveryArchiveModal onClose={() => undefined} resumeId={3} archiveApi={api} />
      </AntdApp>,
    );
    expect(await screen.findByText(ARTIFACT_FILENAME)).toBeInTheDocument();
    expect(await screen.findByText(t("delivery.archive.title"))).toBeInTheDocument();
    await waitFor(() => expect(api.calls).toContain("list-artifacts"));
  });

  it("不传 resumeId：不渲染原件区（全局存档页行为不变）", async () => {
    render(
      <AntdApp>
        <DeliveryArchiveModal onClose={() => undefined} />
      </AntdApp>,
    );
    // 等全局存档表加载完再断言"原件区不存在"。
    await waitFor(() => expect(screen.queryByText(t("delivery.archive.title"))).toBeNull());
  });

  it("宿主给 resumeOptions：在弹层里选简历后加载该简历的原件（全局入口也能用）", async () => {
    const api = mockArchiveApi();
    render(
      <AntdApp>
        <DeliveryArchiveModal
          onClose={() => undefined}
          resumeOptions={[{ value: 3, label: "后端简历" }]}
          archiveApi={api}
        />
      </AntdApp>,
    );
    // 初始没有简历上下文 → 不加载原件。
    expect(screen.queryByText(t("delivery.archive.title"))).toBeNull();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("delivery.archive.resumePicker") }));
    // i18n-ok: 合成简历标题（测试数据，非界面文案）
    fireEvent.click(await screen.findByText("后端简历"));
    expect(await screen.findByText(ARTIFACT_FILENAME)).toBeInTheDocument();
    await waitFor(() => expect(api.calls).toContain("list-artifacts"));
  });
});
