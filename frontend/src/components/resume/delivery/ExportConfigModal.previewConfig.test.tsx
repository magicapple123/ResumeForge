// SPDX-License-Identifier: Apache-2.0
/**
 * W04 配置预览测试（task-14 A）：导出弹层里的「预览这份配置」把水印/脱敏带进预览请求，
 * 成功后内联 iframe；后端未就绪时给能力缺失提示而不是报坏产物。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { createMockExportDeliveryApi } from "../../../features/resume-delivery";
import { makeResumeDocument } from "../../../test/documentHarness";
import ExportConfigModal from "./ExportConfigModal";

const { previewMock, unsupportedError } = vi.hoisted(() => {
  class Unsupported extends Error {}
  return { previewMock: vi.fn(), unsupportedError: Unsupported };
});

vi.mock("../../../features/resume-delivery/configPreview", () => ({
  ConfigPreviewUnsupportedError: unsupportedError,
  previewExportConfig: previewMock,
}));

const CONTENT = makeResumeDocument();

function renderModal() {
  const api = createMockExportDeliveryApi({
    content: CONTENT,
    currentRevision: 3,
    serverCheck: "unavailable",
  });
  render(
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
      />
    </AntdApp>,
  );
  return api;
}

beforeEach(() => {
  previewMock.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:config-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("W04 配置预览（水印 / 脱敏）", () => {
  it("点击预览：请求带水印/脱敏，成功后内联 iframe 并说明这不是编辑预览", async () => {
    previewMock.mockResolvedValue({
      blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      pages: 1,
      pagesNeeded: 2,
      pageLimit: 3,
      overflow: true,
    });
    renderModal();
    fireEvent.change(screen.getByRole("textbox", { name: t("delivery.config.watermark") }), {
      target: { value: "内部评审" },
    });
    fireEvent.click(screen.getByRole("switch", { name: t("delivery.config.redact") }));
    fireEvent.click(screen.getByRole("button", { name: t("delivery.preview.action") }));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    expect(previewMock.mock.calls[0][0]).toMatchObject({
      resumeId: 3,
      template: "classic",
      watermark: "内部评审",
      redact: true,
    });
    // 卡片上必须写清"这不是编辑预览"。
    expect(screen.getByText(t("delivery.preview.notEditPreview"))).toBeInTheDocument();
    expect(await screen.findByTitle(t("delivery.preview.title"))).toBeInTheDocument();
    // i18n-ok: 页面数由 t("delivery.preview.pages") 生成，这里按合成值断言
    expect(screen.getByText(/约需 2 页/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t("delivery.preview.overflow")))).toBeInTheDocument();
  });

  it("后端未就绪（422 → Unsupported）时提示能力缺失，不展示空 iframe", async () => {
    previewMock.mockRejectedValue(new unsupportedError("not supported"));
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: t("delivery.preview.action") }));
    expect(await screen.findByText(t("delivery.preview.unsupported"))).toBeInTheDocument();
    expect(screen.queryByTitle(t("delivery.preview.title"))).not.toBeInTheDocument();
  });
});
