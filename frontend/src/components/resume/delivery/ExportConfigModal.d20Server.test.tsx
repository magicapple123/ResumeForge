// SPDX-License-Identifier: Apache-2.0
/**
 * D20 服务端核对接入测试（task-14 C）：
 * - 打开弹层即发 `purpose:"export"` 核对，服务端可用时卡片标注"服务端"来源；
 * - 「重新核对」真的再发一次（不是空函数）；
 * - W16：选择变体后导出请求带 variant_id。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { createMockExportDeliveryApi } from "../../../features/resume-delivery";
import { makeResumeDocument } from "../../../test/documentHarness";
import ExportConfigModal from "./ExportConfigModal";

vi.mock("../../../features/resume-delivery/configPreview", () => ({
  ConfigPreviewUnsupportedError: class ConfigPreviewUnsupportedError extends Error {},
  previewExportConfig: vi.fn(),
}));

const CONTENT = makeResumeDocument();

function renderModal(
  api: ReturnType<typeof createMockExportDeliveryApi>,
  variants: Parameters<typeof ExportConfigModal>[0]["variants"] = [],
) {
  return render(
    <AntdApp>
      <ExportConfigModal
        open
        onClose={() => undefined}
        api={api}
        resumeId={3}
        content={CONTENT}
        revision={3}
        resumeTitle="后端简历"
        company="甲公司"
        jobTitle="后端工程师"
        template="classic"
        language="zh-CN"
        variants={variants}
      />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("D20 服务端核对", () => {
  it("打开弹层就发核对；服务端可用时标注服务端来源，重新核对会再发一次", async () => {
    const api = createMockExportDeliveryApi({
      content: CONTENT,
      company: "甲公司",
      jobTitle: "后端工程师",
      resumeTitle: "后端简历",
      currentRevision: 3,
    });
    renderModal(api);
    await waitFor(() => expect(api.calls.filter((c) => c === "check-export")).toHaveLength(1));
    expect(await screen.findByText(t("delivery.check.source.server"))).toBeInTheDocument();
    // antd 的 loading 图标也参与 accessible name（"loading重新核对"），用正则匹配；
    // 等核对真正结束（按钮不再 disabled）再点，否则 loading 态会吞掉点击。
    const refreshButton = await waitFor(() => {
      const found = screen.getByRole("button", { name: new RegExp(t("delivery.check.refresh")) });
      expect(found).not.toBeDisabled();
      return found;
    });
    fireEvent.click(refreshButton);
    await waitFor(() => expect(api.calls.filter((c) => c === "check-export")).toHaveLength(2));
    // 核对请求带的是与导出同一份快照（版式），purpose 由适配层加。
    expect(api.checkRequests[0]).toMatchObject({
      layout: { template: "classic", language: "zh-CN", page_limit: null },
    });
  });

  it("后端未就绪（feature-detect 返回 null）时回退本地并如实标注", async () => {
    const api = createMockExportDeliveryApi({
      content: CONTENT,
      company: "甲公司",
      jobTitle: "后端工程师",
      resumeTitle: "后端简历",
      currentRevision: 3,
      serverCheck: "unavailable",
    });
    renderModal(api);
    await waitFor(() => expect(api.calls).toContain("check-export"));
    expect(await screen.findByText(t("delivery.check.source.local"))).toBeInTheDocument();
    // i18n-ok: 合成目标岗位断言（测试数据，非界面文案）
    expect(screen.getByText("甲公司 · 后端工程师")).toBeInTheDocument();
  });

  it("核对真失败时显示失败提示，不把本地摘要说成服务端结论", async () => {
    const api = createMockExportDeliveryApi({ serverCheck: "error" });
    renderModal(api);
    expect(await screen.findByText(t("delivery.check.failed"))).toBeInTheDocument();
    expect(screen.getByText(t("delivery.check.source.local"))).toBeInTheDocument();
  });

  it("选择岗位变体后导出请求带 variant_id", async () => {
    const api = createMockExportDeliveryApi({ content: CONTENT, currentRevision: 3 });
    renderModal(api, [{ id: 11, name: "后端变体", job_title: "后端" }]);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("delivery.variant.label") }));
    // i18n-ok: 合成变体名（测试数据，非界面文案）
    fireEvent.click(await screen.findByText("后端变体 · 后端"));
    const exportButton = screen.getByRole("button", { name: t("delivery.export.action") });
    fireEvent.click(exportButton);
    await waitFor(() => expect(api.calls).toContain("export-bundle"));
    expect(api.bundleRequests[0].variant_id).toBe(11);
  });
});
