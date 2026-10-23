// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **纸面加粗（overlay）参与脏值**（阻断缺陷回归）。
 *
 * 缺陷原样（QA 复现路径）：在纸面上右键加粗 → 纸面立刻变粗 → 直接关掉制作台。什么都没存，
 * 也没提示。原因是 overlay 住在 `useRichTextOverrides` 里，而制作台的脏值只认
 * 「中栏表单脏（`editorDirty`）」与「版式与快照不同（`layoutDirty`）」：
 *
 * 1. 顶部「保存修改 / 取消修改」不出现（`dirty` 为 false）；
 * 2. 关闭确认不问（`needsCloseConfirm` 只看 `dirty || isDraft`）；
 * 3. 即使按钮出现，`useWorkbenchOverallSave.save()` 里 `if (editorDirty)` 那道门也进不去，
 *    内容一次都不会写回。
 *
 * 修法只有一处：`ResumeZoomModal` 把 `richDirty` 并进 `editorDirty` 与动作条的 `dirty`。
 * 这一组用例就从**用户能看到的三颗按钮**上把它钉住（不测内部状态），因为缺陷的形态正是
 * "界面看起来一切正常，只是什么都没保存"。
 *
 * 为什么单独成文件：`ResumeWorkbenchOverallSave.test.tsx` 已到 489 行（测试文件同样是 500
 * 行零豁免），再塞四条会直接超线；那一份的夹具（`renderWorkbench`）也留在原处，这里按同一
 * 套接线重写一份最小版（复制五行的夹具比拆文件更不容易腐烂）。
 *
 * 断言文案一律走 `t()`（`cjkRatchet` 的 tests 口径逐文件卡中文）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import ResumeZoomModal from "./ResumeZoomModal";

// 目录只取一次（组件自己调 hook）；这里直接下发夹具，避免多一次网络桩。
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 右栏预览是真 iframe + 量高，与本文件的"按钮可见性"断言无关。
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

const CONTENT: ResumeContent = {
  photo: "",
  name: "Alex",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

/** 挂一个"中栏与版式都干净、只有纸面加粗是脏的"制作台。 */
function renderRichOnly(richDirty: boolean) {
  const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
  const onDiscardRichText = vi.fn();
  const onClose = vi.fn();

  /**
   * 与真宿主一致：`onDiscardRichText` 真的把 overlay 清掉（`overlays.clear()`），
   * 于是 `richDirty` 转 false、按钮收起——静态传 true 会让"放弃后按钮还在"永远测不出来。
   */
  function Harness() {
    const [richOpen, setRichOpen] = useState(richDirty);
    return (
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={onClose}
          layout={LAYOUT}
          resumeId={42}
          content={CONTENT}
          onApplyLayout={vi.fn()}
          onCommitLayout={async () => true}
          onSaveContent={onSaveContent}
          richDirty={richOpen}
          onDiscardRichText={() => {
            onDiscardRichText();
            setRichOpen(false);
          }}
        />
      </AntdApp>
    );
  }

  const view = render(<Harness />);
  return { ...view, onSaveContent, onDiscardRichText, onClose };
}

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  if (!node) throw new Error("动作条未渲染");
  return node;
}

function topSave(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
}

function topCancel(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.cancel-changes")),
  });
}

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

describe("制作台 · 纸面加粗参与脏值", () => {
  it("干净时没有任何改动信号（对照组，防止用例假通过）", async () => {
    renderRichOnly(false);
    await waitFor(() => expect(document.querySelector(".resume-wb-editor-body")).not.toBeNull());
    expect(topSave()).toBeNull();
    expect(topCancel()).toBeNull();
  });

  it("只加了粗：顶部出现保存与取消", async () => {
    renderRichOnly(true);
    await waitFor(() => expect(topSave()).not.toBeNull());
    expect(topCancel()).not.toBeNull();
  });

  it("点保存：进得去内容保存链路（宿主随后合并 overlay 再 PATCH）", async () => {
    const { onSaveContent, onClose } = renderRichOnly(true);

    await waitFor(() => expect(topSave()).not.toBeNull());
    await act(async () => {
      fireEvent.click(topSave() as HTMLElement);
    });

    // `save()` 只有看到 `editorDirty` 才会去点中栏；加粗并进来之后这条门才打开。
    await waitFor(() => expect(onSaveContent).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("点取消修改并确认：把 overlay 一起丢掉，且一次内容 PATCH 都不发", async () => {
    const { onDiscardRichText, onSaveContent } = renderRichOnly(true);

    await waitFor(() => expect(topCancel()).not.toBeNull());
    fireEvent.click(topCancel() as HTMLElement);
    const alert = await within(actionbar()).findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: t("common.action.discard") }));

    await waitFor(() => expect(onDiscardRichText).toHaveBeenCalledTimes(1));
    expect(onSaveContent).not.toHaveBeenCalled();
    // 脏值消失后两颗按钮收起（纸面回到"没有改动"）。
    await waitFor(() => expect(topSave()).toBeNull());
  });

  it("点关闭：先问一句「还有改动没有保存」", async () => {
    const { onClose } = renderRichOnly(true);

    fireEvent.click(screen.getByRole("button", { name: t("common.action.close") }));

    expect(await screen.findByText(t("workbench.close.title"))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
