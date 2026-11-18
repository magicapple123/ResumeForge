// SPDX-License-Identifier: Apache-2.0
/**
 * QW 系列制作台保存测试的**共享装配**（真实 ResumeDetailPreview 宿主 + 动作条查询）。
 *
 * 拆出来的原因：两批行为（默认保存 / 部分成功矩阵）共用同一套"打开制作台、改版式、
 * 改正文、点动作条"的路径；复制两份会让宿主 props 与选择器在多处漂移。
 *
 * 本文件不是测试文件（文件名不含 `.test.`），不跑用例；`vi.mock` 仍留在各测试文件里，
 * 因为 mock 的作用域是"声明它的测试模块"。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { expect, vi } from "vitest";
import { t } from "../../src/i18n";
import { makeResumeDetail, makeResumeDocument } from "../../src/test/documentHarness";
import { headerFieldInput } from "../../src/test/headerChip";
import type { ResumeDetail, ResumeDocument, ResumeLayout } from "../../src/types";
import type { ResumeDocumentPipeline } from "../../src/features/resume/document/types";
import { DEFAULT_LAYOUT } from "../../src/features/resume/layout/ResumeLayoutControls.testkit";
import ResumeDetailPreview from "../../src/features/resume/preview/ResumeDetailPreview";

/** 打开时的版式：format_config 为空；点一次色板就能造出"版式脏"。 */
export const OPENING_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

export const NAME = "Alex";
export const EDITED_NAME = "\u674e\u56db";

export function documentWithName(name: string): ResumeDocument {
  const document = makeResumeDocument();
  const item = document.header.items.find((candidate) => candidate.key === "name");
  if (item) item.value = name;
  return document;
}

export const DETAIL: ResumeDetail = {
  ...makeResumeDetail({ id: 42, title: "我的简历", revision: 3 }),
  content: documentWithName(NAME),
};

/**
 * 版式变化必须走 V2 自己的参数面板（色板）——与真用户同一条链路：
 * 参数面板 → history.recordLayout → 宿主 onApplyLayout → layout prop 回灌。
 */
export interface RenderOptions {
  detail?: ResumeDetail;
  commitLayout?: () => Promise<boolean>;
  withoutCommitLayout?: boolean;
  pipeline?: ResumeDocumentPipeline;
}

export function renderWorkbench(options: RenderOptions = {}) {
  const onApplyLayout = vi.fn<(next: ResumeLayout) => void>();
  const onSaveContent = vi.fn<(next: ResumeDocument, revision?: number) => Promise<void>>(
    async () => undefined,
  );
  const onCommitLayout = vi.fn(options.commitLayout ?? (async () => true));
  const onPublishDraft = vi.fn(async () => true);
  const detail = options.detail ?? DETAIL;

  function Harness() {
    const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
    return (
      <MemoryRouter>
        <AntdApp>
          <ResumeDetailPreview
            detail={detail}
            html="<html></html>"
            layout={layout}
            layoutStatus={null}
            measure={null}
            pdfDirectAvailable
            relayouting={false}
            previewRef={{ current: null }}
            onLayoutStatus={vi.fn()}
            onMeasure={vi.fn()}
            onApplyLayout={(next) => {
              onApplyLayout(next);
              setLayout(next);
            }}
            onApplyFittedFormat={vi.fn()}
            onSaveEditedResume={onSaveContent}
            suggestionsGenerated={false}
            suggestionsResetKey={0}
            onSuggestionsGenerated={vi.fn()}
            {...(options.withoutCommitLayout ? {} : { onCommitLayout })}
            onPublishDraft={onPublishDraft}
            documentPipeline={options.pipeline}
          />
        </AntdApp>
      </MemoryRouter>
    );
  }

  const view = render(<Harness />);
  return { onApplyLayout, onSaveContent, onCommitLayout, onPublishDraft, unmount: view.unmount };
}

export function makePipeline() {
  const revision = 3;
  const saveLayout = vi.fn(async () => ({ status: "saved" as const, revision: 4 }));
  // 参数签名要显式写出来：有的用例要读 `mock.calls[0][1]`（条件写带的 base revision）。
  const saveContent = vi.fn<(content: ResumeDocument, expectedRevision: number) => Promise<number>>(
    async () => 5,
  );
  const pipeline: ResumeDocumentPipeline = {
    revision,
    saveLayout,
    saveContent,
    publishDraft: vi.fn(async () => ({ status: "saved" as const, revision: 5 })),
    fetchLatest: vi.fn(async () => {
      throw new Error("not used");
    }),
    adoptLatest: vi.fn(),
    saveAsCopy: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  return { pipeline, saveLayout, saveContent };
}

export async function openWorkbench(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("workbench.title")) }));
  await screen.findByRole("dialog", { name: t("workbench.title") });
}

export function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

export function topSave(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
}

export function topPublish(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.publish")),
  });
}

export function topCancel(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.cancel-changes")),
  });
}

/** QW-1：撤销 / 恢复（图标按钮，读屏名来自 aria-label）。 */
export function topUndo(): HTMLElement {
  return within(actionbar()).getByRole("button", { name: t("workbench.history.undo") });
}

export function topRedo(): HTMLElement {
  return within(actionbar()).getByRole("button", { name: t("workbench.history.redo") });
}

/** QW-2：「重试正文」只重跑正文那一步。 */
export function retryContent(): HTMLElement {
  return within(actionbar()).getByRole("button", { name: t("workbench.action.retry-content") });
}

/** #10：页眉字段是 chip，值输入框在展开态里（见 src/test/headerChip.ts）。 */
export function nameInput(): HTMLInputElement {
  return headerFieldInput("document.headerField.name");
}

/**
 * 点一次预设色板 = 改一处**版式**。
 *
 * 结构随 I-09 变过一次：**2×2 色卡 + 单一取色器**（原来"手风琴 + 四下色块列表"）。
 * 即旧的 `.resume-wb-swatches` / `.resume-wb-color-toggle` 已不存在，改成：
 * 先点某张卡的 `.resume-wb-color-main`（打开取色器），再点 antd 的预设色块。
 * 取色器只有一个实例、随 `pickerKey` 移动，所以"已经开着"就不要再点卡（会关掉）。
 *
 * 改哪一行都一样，这里固定点第一张卡。
 */
export function pickSwatch(): void {
  if (!document.querySelector(".ant-color-picker-presets-color")) {
    const cardMain = document.querySelector<HTMLElement>(".resume-wb-color-main");
    expect(cardMain).not.toBeNull();
    fireEvent.click(cardMain as HTMLElement);
  }
  const preset = document.querySelector<HTMLElement>(".ant-color-picker-presets-color");
  expect(preset).not.toBeNull();
  fireEvent.click(preset as HTMLElement);
}

/** 改版式并等到"有改动"信号出现（顶部出现保存按钮）。 */
export async function changeLayout(): Promise<void> {
  pickSwatch();
  await waitFor(() => expect(topSave()).not.toBeNull());
}

export function closeButton(): HTMLElement {
  return within(actionbar()).getByRole("button", { name: t("common.action.close") });
}
