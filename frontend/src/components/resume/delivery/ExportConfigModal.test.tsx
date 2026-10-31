// SPDX-License-Identifier: Apache-2.0
/**
 * 「导出交付包」弹层测试（W19 / D18–D20）：D20 六项核对、能力矩阵标注、命名预览、
 * 成套导出调用、strict_revision 409 的冲突提示。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { createMockExportDeliveryApi } from "../../../features/resume-delivery";
import { makeResumeDocument } from "../../../test/documentHarness";
import ExportConfigModal from "./ExportConfigModal";

const TARGET_TEXT = "甲公司 · 后端工程师";
/** v2 文档：页眉带姓名与联系方式，正文无隐藏项（D20 核对六项的取值口径）。 */
const CONTENT = makeResumeDocument();

function button(label: string): HTMLElement {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(escaped.split("").join("\\s*")) });
}

function renderModal(options: { currentRevision?: number; revision?: number } = {}) {
  const api = createMockExportDeliveryApi({
    content: CONTENT,
    company: "甲公司",
    jobTitle: "后端工程师",
    resumeTitle: "后端简历",
    currentRevision: options.currentRevision ?? 3,
  });
  const onExported = vi.fn();
  const onClose = vi.fn();
  render(
    <AntdApp>
      <ExportConfigModal
        open
        onClose={onClose}
        api={api}
        resumeId={3}
        content={CONTENT}
        revision={options.revision ?? 3}
        resumeTitle="后端简历"
        company="甲公司"
        jobTitle="后端工程师"
        template="classic"
        language="zh-CN"
        onExported={onExported}
      />
    </AntdApp>,
  );
  return { api, onExported, onClose };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("D20 核对与能力矩阵", () => {
  it("核对卡展示目标岗位/联系方式/版本/隐藏条目", async () => {
    renderModal();
    expect(await screen.findByText(TARGET_TEXT)).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText(t("delivery.check.contactPresent"))).toBeInTheDocument();
    expect(screen.getByText(t("delivery.check.hiddenNone"))).toBeInTheDocument();
    expect(screen.getByText(t("delivery.check.mode.resume"))).toBeInTheDocument();
  });

  it("Word 标注「近似」而不是隐藏差异；格式可勾选", () => {
    renderModal();
    expect(screen.getByText(t("delivery.capability.approx"))).toBeInTheDocument();
    const markdown = screen.getByRole("checkbox", { name: t("delivery.format.md") });
    fireEvent.click(markdown);
    expect(markdown).toBeChecked();
  });
});

describe("命名预览与导出", () => {
  it("修改命名规则即时更新文件名预览", () => {
    renderModal();
    const input = screen.getByRole("textbox", { name: t("delivery.naming.label") });
    fireEvent.change(input, { target: { value: "{name}-{date}" } });
    const preview = document.querySelector(".resume-delivery-preview code");
    expect(preview?.textContent).toMatch(/^张三-\d{8}\.pdf$/);
  });

  it("导出交付包：调 bundle 接口并回调宿主（成功才提示）", async () => {
    const { api, onExported } = renderModal();
    fireEvent.click(button(t("delivery.export.action")));
    await waitFor(() => expect(api.calls).toContain("export-bundle"));
    expect(onExported).toHaveBeenCalledTimes(1);
  });

  it("strict_revision 409：显示「版本已更新」提示，不下载、不自动重试", async () => {
    const { api, onExported } = renderModal({ currentRevision: 4, revision: 3 });
    fireEvent.click(button(t("delivery.export.action")));
    expect(await screen.findByText(t("delivery.revision.title"))).toBeInTheDocument();
    expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(1);
    expect(onExported).not.toHaveBeenCalled();
  });
});
