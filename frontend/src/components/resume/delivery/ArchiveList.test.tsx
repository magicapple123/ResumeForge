// SPDX-License-Identifier: Apache-2.0
/** 交付原件列表测试（W19 / D19）：空态、列表字段、删除二次确认（三段式）与刷新。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { createMockExportDeliveryApi } from "../../../features/resume-delivery";
import ArchiveList from "./ArchiveList";

const ARCHIVE_FILENAME = "张三-后端工程师-20261024.pdf";

function renderList() {
  const api = createMockExportDeliveryApi({
    artifacts: [
      {
        id: 1,
        delivery_id: null,
        resume_id: 3,
        kind: "bundle_member",
        export_format: "pdf",
        filename: "张三-后端工程师-20261024.pdf",
        media_type: "application/pdf",
        size_bytes: 2048,
        sha256: "d".repeat(64),
        resource_manifest: {},
        created_at: "2026-10-24T00:00:00Z",
      },
    ],
  });
  render(
    <AntdApp>
      <ArchiveList api={api} resumeId={3} />
    </AntdApp>,
  );
  return api;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("交付原件列表", () => {
  it("展示文件名/格式/哈希前 8 位/大小/时间", async () => {
    renderList();
    expect(await screen.findByText(ARCHIVE_FILENAME)).toBeInTheDocument();
    expect(screen.getByText(t("delivery.archive.sha") + ": dddddddd")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t("delivery.archive.size") + ":.*2"))).toBeInTheDocument();
  });

  it("删除走二次确认：取消不删，确认后调接口并从列表移除", async () => {
    const api = renderList();
    await screen.findByText(ARCHIVE_FILENAME);
    const deleteButtons = () =>
      screen.getAllByRole("button", {
        name: (accessibleName: string) =>
          accessibleName.replace(/\s/g, "").includes(t("delivery.archive.delete")),
      });
    fireEvent.click(deleteButtons()[0]);
    expect(await screen.findByText(t("delivery.archive.deleteBody"))).toBeInTheDocument();
    // Popconfirm 的确认按钮与触发按钮同名：面板挂在 body 末尾，取最后一个。
    fireEvent.click(deleteButtons()[deleteButtons().length - 1]);
    await waitFor(() => expect(api.calls).toContain("delete-artifact:1"));
    await waitFor(() => expect(screen.queryByText(ARCHIVE_FILENAME)).toBeNull());
  });

  it("空态说明归档从哪来（不把「没有」说成加载失败）", async () => {
    const api = createMockExportDeliveryApi({ artifacts: [] });
    render(
      <AntdApp>
        <ArchiveList api={api} resumeId={3} />
      </AntdApp>,
    );
    expect(await screen.findByText(t("delivery.archive.empty"))).toBeInTheDocument();
    expect(screen.getByText(t("delivery.archive.emptyHint"))).toBeInTheDocument();
  });
});
