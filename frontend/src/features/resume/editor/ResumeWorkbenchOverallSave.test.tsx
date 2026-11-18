// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **一对**整体的保存 / 取消（v2 文档模型）。
 *
 * 原 v1 版经旧 ResumeZoomModal 壳验证同一批行为；旧壳删除后（Lead 拍板）改写到 V2 壳
 * （ResumeWorkbenchV2，经 ResumeDetailPreview 真实宿主挂载），断言口径不变：
 *
 * 1. 中栏底部那对局部按钮不渲染（保存入口只有动作条一颗）；
 * 2. **只改版式**也算有改动，顶部那对出现；
 * 3. 「取消」两件事都做——内容回填 + 版式回滚到打开制作台那一刻；
 * 4. 「保存」两件事都做——版式落库（onCommitLayout）+ 内容提交；版式失败时按钮留在原地；
 * 5. Esc / × 在有改动时先就地确认，且确认句点名丢的是排版参数还是内容；
 * 6. 草稿（isDraft）什么都没改时按钮是「保存到简历中心」，关闭也要问一句。
 *
 * QW-2 的"部分成功"矩阵单独成文件（`*.partial.test.tsx`），共享装配见
 * `workbenchSaveFixtures.tsx`。断言文案一律走 `t()`。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeDetail, ResumeDocument } from "../../../types";
import { readActiveDatasetId } from "../../../utils/datasetScope";
import {
  DETAIL,
  EDITED_NAME,
  NAME,
  OPENING_LAYOUT,
  changeLayout,
  closeButton,
  documentWithName,
  makePipeline,
  nameInput,
  openWorkbench,
  renderWorkbench,
  topCancel,
  topPublish,
  topRedo,
  topSave,
  topUndo,
} from "../../../../tests/helpers/workbenchSaveFixtures";
import { writeResumeDraft } from "./useWorkbenchResumeDraft";

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

describe("制作台 · 只剩一对整体动作", () => {
  it("中栏底部不再渲染「保存内容 / 放弃修改」，整行都不留", async () => {
    renderWorkbench();
    await openWorkbench();

    expect(document.querySelector(".resume-wb-editor-actions")).toBeNull();
    const editorColumn = document.querySelector(".resume-wb-col-editor");
    expect(editorColumn?.querySelector("button[class*='save']")).toBeNull();
  });

  it("只改了版式（没碰内容）就有改动信号：顶部出现保存与取消", async () => {
    renderWorkbench();
    await openWorkbench();
    expect(topSave()).toBeNull();

    await changeLayout();

    expect(topSave()).not.toBeNull();
    expect(topCancel()).not.toBeNull();
  });
});

describe("制作台 · 取消 = 内容回填 + 版式回滚", () => {
  it("确认后版式退回打开制作台那一刻，且一次内容 PATCH 都没发", async () => {
    const { onApplyLayout, onSaveContent } = renderWorkbench();
    await openWorkbench();
    await changeLayout();

    fireEvent.click(topCancel() as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: t("common.action.discard") }));

    await waitFor(() => expect(onApplyLayout).toHaveBeenCalledWith(OPENING_LAYOUT));
    expect(onSaveContent).not.toHaveBeenCalled();
    expect(topSave()).toBeNull();
  });
});

describe("制作台 · 保存把版式真正落库", () => {
  it("只改版式时保存：调一次 onCommitLayout，一次内容 PATCH 都不发", async () => {
    const { onCommitLayout, onSaveContent } = renderWorkbench();
    await openWorkbench();
    await changeLayout();

    fireEvent.click(topSave() as HTMLElement);

    await waitFor(() => expect(onCommitLayout).toHaveBeenCalledTimes(1));
    expect(onSaveContent).not.toHaveBeenCalled();
  });

  it("版式落库失败：快照不对齐，保存按钮留在原地等重试", async () => {
    const { onCommitLayout } = renderWorkbench({ commitLayout: async () => false });
    await openWorkbench();
    await changeLayout();

    fireEvent.click(topSave() as HTMLElement);

    await waitFor(() => expect(onCommitLayout).toHaveBeenCalledTimes(1));
    await screen.findByText(t("workbench.conflict.save-failed"));
    expect(topSave()).not.toBeNull();
  });

  /**
   * 关闭确认与「丢的是什么」的点名。
   *
   * 触发路径用动作条的 ×（与 Esc 同义：Esc 走同一个 closeGuard → ActionBar 左侧就地确认卡片，
   * 见 useWorkbenchCloseGuard / WorkbenchModalFrame.onCancel；antd 6 的全局 Esc 栈在整页树里
   * 不可观测——单独渲染 WorkbenchModalFrame 时 Esc 可触发，套进真实预览树后 portal 的 Esc 栈
   * 为空，属测试环境限制，不再用 Esc 派发制造假阴性）。
   */
  it("只改版式时关闭：不关制作台，先出一张确认卡片并点名丢的是排版参数", async () => {
    renderWorkbench();
    await openWorkbench();
    await changeLayout();

    fireEvent.click(closeButton());

    await screen.findByText(t("workbench.actionbar.discard.close-layout"));
    expect(screen.getByRole("dialog", { name: t("workbench.title") })).toBeInTheDocument();
  });

  it("没传 onCommitLayout：内容脏时保存照样走 onSaveContent（退化成只存内容）", async () => {
    const { onSaveContent } = renderWorkbench({ withoutCommitLayout: true });
    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });

    fireEvent.click(topSave() as HTMLElement);

    await waitFor(() => expect(onSaveContent).toHaveBeenCalledTimes(1));
    const saved = onSaveContent.mock.calls[0][0];
    expect(saved.header.items.find((item) => item.key === "name")?.value).toBe(EDITED_NAME);
  });
});

describe("制作台 · 内容 + 版式同时脏（主路径）", () => {
  it("内容 + 版式都脏时保存：先版式后正文，revision 一路传递", async () => {
    const { pipeline, saveLayout, saveContent } = makePipeline();
    renderWorkbench({ pipeline });
    await openWorkbench();

    await changeLayout();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });
    fireEvent.click(topSave() as HTMLElement);

    await waitFor(() => expect(saveContent).toHaveBeenCalledTimes(1));
    expect(saveLayout).toHaveBeenCalledWith(3);
    const [document, revision] = saveContent.mock.calls[0] as unknown as [ResumeDocument, number];
    expect(revision).toBe(4);
    expect(document.header.items.find((item) => item.key === "name")?.value).toBe(EDITED_NAME);
    expect(saveLayout.mock.invocationCallOrder[0]).toBeLessThan(
      saveContent.mock.invocationCallOrder[0] as number,
    );
  });
});

describe("制作台 · 草稿（0051）", () => {
  const DRAFT_DETAIL: ResumeDetail = { ...DETAIL, draft: true };

  it("什么都没改也有「保存到简历中心」，点了只发一次发布请求", async () => {
    const { pipeline } = makePipeline();
    renderWorkbench({ detail: DRAFT_DETAIL, pipeline });
    await openWorkbench();

    expect(topPublish()).not.toBeNull();
    fireEvent.click(topPublish() as HTMLElement);

    await waitFor(() => expect(pipeline.publishDraft).toHaveBeenCalledTimes(1));
    expect(pipeline.saveContent).not.toHaveBeenCalled();
  });

  it("草稿什么都没改就关：也要问一句，丢的是这份简历本身", async () => {
    renderWorkbench({ detail: DRAFT_DETAIL });
    await openWorkbench();

    fireEvent.click(closeButton());

    await screen.findByText(t("workbench.close.body-draft"));
    expect(screen.getByRole("dialog", { name: t("workbench.title") })).toBeInTheDocument();
  });
});

describe("制作台 · 顶栏撤销 / 恢复（QW-1）", () => {
  it("没有历史时两颗按钮都禁用；改一次正文后可撤销、撤销后可用恢复", async () => {
    renderWorkbench();
    await openWorkbench();

    expect(topUndo()).toBeDisabled();
    expect(topRedo()).toBeDisabled();

    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });
    await waitFor(() => expect(topUndo()).toBeEnabled(), { timeout: 3000 });

    fireEvent.click(topUndo());
    await waitFor(() => expect(nameInput().value).toBe(NAME));
    expect(topRedo()).toBeEnabled();

    fireEvent.click(topRedo());
    await waitFor(() => expect(nameInput().value).toBe(EDITED_NAME));
  });

  it("输入框聚焦时点击撤销不丢焦点（按钮不抢焦点）", async () => {
    renderWorkbench();
    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });
    await waitFor(() => expect(topUndo()).toBeEnabled(), { timeout: 3000 });

    const input = nameInput();
    input.focus();
    fireEvent.mouseDown(topUndo());
    fireEvent.click(topUndo());

    await waitFor(() => expect(nameInput().value).toBe(NAME));
    expect(document.activeElement).toBe(nameInput());
  });

  it("Tooltip 用历史摘要说清将要撤销什么", async () => {
    renderWorkbench();
    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });
    await waitFor(() => expect(topUndo()).toBeEnabled(), { timeout: 3000 });

    // React 的 onMouseEnter 由 mouseover 合成，直接派发 mouseenter 不会触发。
    fireEvent.mouseOver(topUndo().parentElement as HTMLElement);

    // 摘要形态：「撤销「…」」——具体步骤名由 changeSummary 决定，这里钉两件事：
    // 不是"没有可撤销"的空态提示，且带上了这一步改到的内容（姓名）。
    // 用 role=tooltip 而不是 `.ant-tooltip-inner`：antd 会先挂一个空的内层节点，
    // 按 class 取第一个会稳定拿到空串。
    const tooltip = await screen.findByRole("tooltip");
    await waitFor(() => {
      const text = tooltip.textContent ?? "";
      expect(text).not.toBe(t("workbench.history.undo.hint"));
      expect(text).toContain(EDITED_NAME);
    });
  });
});

describe("制作台 · 会话草稿恢复（QW-5）", () => {
  it("改正文 → 重新打开 → 出现恢复条 → 点恢复后内容回到刷新前", async () => {
    const first = renderWorkbench();
    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });
    // 卸载即 flush：草稿是"刷新/误关"那一下的兜底，不需要等 450ms 防抖。
    first.unmount();
    expect(sessionStorage.length).toBeGreaterThan(0);

    renderWorkbench();
    await openWorkbench();

    await screen.findByText(t("draft.restore.title"));
    // 恢复条同时说清这份草稿基于哪一版（没注入 pipeline 的宿主 revision 为 0）。
    expect(screen.getByText(t("workbench.draft.baseline", { revision: 0 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("draft.restore.action") }));

    await waitFor(() => expect(nameInput().value).toBe(EDITED_NAME));
    // 恢复条取用后消失（不重复问）。
    expect(screen.queryByText(t("draft.restore.title"))).toBeNull();
  });

  it("点「放弃」后草稿被删除，再次打开不再出现恢复条", async () => {
    const first = renderWorkbench();
    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: EDITED_NAME } });
    first.unmount();

    const second = renderWorkbench();
    await openWorkbench();
    await screen.findByText(t("draft.restore.title"));
    fireEvent.click(screen.getByRole("button", { name: t("draft.discard.action") }));
    second.unmount();

    renderWorkbench();
    await openWorkbench();
    // 不自动应用，也不该再有草稿可恢复。
    await waitFor(() => expect(nameInput().value).toBe(NAME));
    expect(screen.queryByText(t("draft.restore.title"))).toBeNull();
  });

  it("服务端版本已前进：恢复后保存用草稿的基准版本做条件写（走冲突，不静默覆盖）", async () => {
    // 草稿写于第 3 版；打开时服务端已经是第 5 版。
    writeResumeDraft(
      { resumeId: 42, datasetId: readActiveDatasetId() },
      3,
      documentWithName(EDITED_NAME),
      OPENING_LAYOUT,
      Date.now(),
    );
    const { pipeline, saveContent } = makePipeline();
    pipeline.revision = 5;
    renderWorkbench({ pipeline });
    await openWorkbench();

    await screen.findByText(t("draft.restore.title"));
    fireEvent.click(screen.getByRole("button", { name: t("draft.restore.action") }));

    // 明确告知：这份草稿基于旧版，下一次保存会先走冲突处理。
    await screen.findByText(t("workbench.draft.revision-ahead"));
    expect(nameInput().value).toBe(EDITED_NAME);

    fireEvent.click(topSave() as HTMLElement);
    await waitFor(() => expect(saveContent).toHaveBeenCalledTimes(1));
    // 条件写带草稿的 3（不是当前 5）：服务端据此返回 409 → 既有三选一。
    expect(saveContent.mock.calls[0][1]).toBe(3);
  });
});
