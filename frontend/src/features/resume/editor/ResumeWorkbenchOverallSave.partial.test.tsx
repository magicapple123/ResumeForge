// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台整体保存的**部分成功矩阵**（QW-2）——从 `ResumeWorkbenchOverallSave.test.tsx`
 * 拆出的一批行为：版式 / 正文两步各自的终态如何对外表达。
 *
 * 1. 版式成功 + 正文失败 → 只一条「部分成功」+「重试正文」，重试只补正文；
 * 2. 版式失败 → 正文一次请求都不发；
 * 3. 只存了版式 → 补唯一一条成功提示（不在两步之间先弹）。
 *
 * 共享装配（宿主、动作条查询、改版式/改正文）见同目录 harness。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import {
  EDITED_NAME,
  changeLayout,
  makePipeline,
  nameInput,
  openWorkbench,
  renderWorkbench,
  retryContent,
  topSave,
} from "../../../../tests/helpers/workbenchSaveFixtures";

vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../preview/ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));
vi.mock("../layout/ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("../layout/ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("../layout/ResumeMeasureControls", () => ({ default: () => null }));
vi.mock("../../../api/profile", () => ({
  getProfile: vi.fn(async () => ({
    photo: "",
    name: "",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    educations: [],
    experiences: [],
    campus_experiences: [],
    projects: [],
    skills: [],
    awards: [],
  })),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台 · 保存结果说诚实（QW-2）", () => {
  it("版式成功、正文失败：只出一条「部分成功」+「重试正文」，重试只重发正文", async () => {
    const { pipeline, saveLayout, saveContent } = makePipeline();
    saveContent.mockRejectedValueOnce(new Error("boom"));
    renderWorkbench({ pipeline });
    await openWorkbench();
    await changeLayout();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });

    fireEvent.click(topSave() as HTMLElement);

    await screen.findByText(t("workbench.conflict.partial-saved"));
    // 不再同时出现通用失败提示 / 版式成功 toast：同一件事只说一遍。
    expect(screen.queryByText(t("workbench.conflict.save-failed"))).toBeNull();
    expect(screen.queryByText(t("workbench.save.layout-saved"))).toBeNull();

    saveContent.mockResolvedValueOnce(9);
    fireEvent.click(retryContent());

    await waitFor(() => expect(saveContent).toHaveBeenCalledTimes(2));
    // 版式基线已经对齐：重试不会把版式再 PATCH 一次。
    expect(saveLayout).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText(t("workbench.conflict.partial-saved"))).toBeNull(),
    );
  });

  it("版式那一步失败：正文一次请求都不发，只留「改动还在」的提示", async () => {
    const { pipeline, saveContent } = makePipeline();
    vi.mocked(pipeline.saveLayout).mockResolvedValueOnce({ status: "failed", error: null });
    renderWorkbench({ pipeline });
    await openWorkbench();
    await changeLayout();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });

    fireEvent.click(topSave() as HTMLElement);

    await screen.findByText(t("workbench.conflict.save-failed"));
    expect(pipeline.saveLayout).toHaveBeenCalledTimes(1);
    expect(saveContent).not.toHaveBeenCalled();
    expect(screen.queryByText(t("workbench.conflict.partial-saved"))).toBeNull();
  });

  it("只存了版式：补唯一一条成功提示（不再由宿主在两步之间先弹）", async () => {
    const { pipeline, saveContent } = makePipeline();
    renderWorkbench({ pipeline });
    await openWorkbench();
    await changeLayout();

    fireEvent.click(topSave() as HTMLElement);

    await screen.findByText(t("workbench.save.layout-saved"));
    expect(saveContent).not.toHaveBeenCalled();
    expect(screen.queryByText(t("workbench.conflict.partial-saved"))).toBeNull();
  });
});
