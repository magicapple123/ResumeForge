// SPDX-License-Identifier: Apache-2.0
/**
 * 批量动作的「本次参数」弹窗：初值来自全局配置、未配置给默认值、确认拿到的是弹窗里改过的
 * 那份（不是全局值）、取消不发请求、导出超过上限时先拦。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import BatchConfigModal from "./BatchConfigModal";

const settingsMocks = vi.hoisted(() => ({ getBatchOperationConfig: vi.fn() }));
const resumeMocks = vi.hoisted(() => ({ fetchResumeTemplates: vi.fn() }));

vi.mock("../../api/settingsBatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settingsBatch")>()),
  getBatchOperationConfig: settingsMocks.getBatchOperationConfig,
}));
vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  fetchResumeTemplates: resumeMocks.fetchResumeTemplates,
}));

const GENERATION = {
  template: "modern",
  format_name: "",
  font_scale: "large",
  page_limit: 2,
  language: "zh-CN",
  enhance: true,
  enhancement_level: "strong",
  custom_instruction: "突出性能优化",
};

const EXPORT = {
  template: "scholar",
  format_name: "",
  font_scale: "small",
  page_limit: 3,
  language: "en-US",
  export_format: "docx",
};

function sections(generationConfigured = true, exportConfigured = true) {
  return {
    generation: { ...GENERATION, configured: generationConfigured, updated_at: null },
    export: { ...EXPORT, configured: exportConfigured, updated_at: null },
  };
}

function renderModal(
  mode: "generation" | "export",
  count: number,
  handlers: { onConfirm: (config: unknown) => void; onCancel: () => void },
) {
  return render(
    <AntdApp>
      <BatchConfigModal open mode={mode} count={count} {...handlers} />
    </AntdApp>,
  );
}

/**
 * antd 会在两个汉字之间插入空格（autoInsertSpace），按去空白后的文本匹配按钮。
 * 这是 antd 的渲染行为，不是我们要断言的文案差异。
 */
function button(text: string): HTMLElement {
  const compact = (value: string | null) => (value ?? "").replace(/\s+/g, "");
  const found = screen
    .getAllByRole("button")
    .find((candidate) => compact(candidate.textContent) === compact(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

beforeEach(() => {
  window.sessionStorage.clear();
  settingsMocks.getBatchOperationConfig.mockReset().mockResolvedValue(sections());
  resumeMocks.fetchResumeTemplates.mockReset().mockResolvedValue(TEMPLATE_CATALOG);
});

afterEach(cleanup);

describe("BatchConfigModal", () => {
  it("打开时初值来自全局配置", async () => {
    renderModal("generation", 3, { onConfirm: vi.fn(), onCancel: vi.fn() });

    expect(
      await screen.findByText(t("batchOperation.modal.count.generation", { count: 3 })),
    ).toBeInTheDocument();
    const pageLimit = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    await waitFor(() => expect(pageLimit.value).toBe("2"));
    // 已配置：不给"当前是默认参数"那条提示。
    expect(screen.queryByText(t("batchOperation.modal.defaults"))).toBeNull();
  });

  it("未配置时给默认值且不阻塞确认", async () => {
    settingsMocks.getBatchOperationConfig.mockResolvedValue(sections(false, false));
    renderModal("export", 1, { onConfirm: vi.fn(), onCancel: vi.fn() });

    expect(await screen.findByText(t("batchOperation.modal.defaults"))).toBeInTheDocument();
    const pageLimit = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    await waitFor(() => expect(pageLimit.value).toBe("1"));
    expect(button(t("batchOperation.modal.start.export"))).toBeEnabled();
  });

  it("确认回调拿到的是弹窗里改过的值", async () => {
    const onConfirm = vi.fn();
    renderModal("generation", 3, { onConfirm, onCancel: vi.fn() });
    await screen.findByText(t("batchOperation.modal.count.generation", { count: 3 }));

    const pageLimit = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    await waitFor(() => expect(pageLimit.value).toBe("2"));
    fireEvent.change(pageLimit, { target: { value: "3" } });
    fireEvent.click(button(t("batchOperation.modal.start.generation")));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ page_limit: 3 }));
    // 全局那份是 2：拿到的必须是改过的 3，而不是读回来的默认值。
    expect(onConfirm.mock.calls[0]![0]).not.toMatchObject({ page_limit: 2 });
  });

  it("取消不发请求", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderModal("generation", 3, { onConfirm, onCancel });
    await screen.findByText(t("batchOperation.modal.count.generation", { count: 3 }));

    fireEvent.click(button(t("common.action.cancel")));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("导出超过 50 份时确认按钮禁用并显示原因", async () => {
    renderModal("export", 51, { onConfirm: vi.fn(), onCancel: vi.fn() });

    expect(
      await screen.findByText(t("batchOperation.modal.exportLimit", { limit: 50 })),
    ).toBeInTheDocument();
    expect(button(t("batchOperation.modal.start.export"))).toBeDisabled();
  });
});
