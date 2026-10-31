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
 * 断言文案一律走 `t()`（cjkRatchet 的 tests 口径逐文件卡中文）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { makeResumeDetail, makeResumeDocument } from "../../test/documentHarness";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeDetail, ResumeDocument, ResumeLayout } from "../../types";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeDetailPreview from "./ResumeDetailPreview";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("./ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("./ResumeMeasureControls", () => ({ default: () => null }));
vi.mock("../../api/profile", () => ({
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

/** 打开时的版式：format_config 为空；点一次色板就能造出"版式脏"。 */
const OPENING_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

const NAME = "Alex";
const EDITED_NAME = "\u674e\u56db";

function documentWithName(name: string): ResumeDocument {
  const document = makeResumeDocument();
  const item = document.header.items.find((candidate) => candidate.key === "name");
  if (item) item.value = name;
  return document;
}

const DETAIL: ResumeDetail = {
  ...makeResumeDetail({ id: 42, title: "我的简历", revision: 3 }),
  content: documentWithName(NAME),
};

/**
 * 版式变化必须走 V2 自己的参数面板（色板）——与真用户同一条链路：
 * 参数面板 → history.recordLayout → 宿主 onApplyLayout → layout prop 回灌。
 */
interface RenderOptions {
  detail?: ResumeDetail;
  commitLayout?: () => Promise<boolean>;
  withoutCommitLayout?: boolean;
  pipeline?: ResumeDocumentPipeline;
}

function renderWorkbench(options: RenderOptions = {}) {
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

  render(<Harness />);
  return { onApplyLayout, onSaveContent, onCommitLayout, onPublishDraft };
}

function makePipeline() {
  const revision = 3;
  const saveLayout = vi.fn(async () => ({ status: "saved" as const, revision: 4 }));
  const saveContent = vi.fn(async () => 5);
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

async function openWorkbench(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("workbench.title")) }));
  await screen.findByRole("dialog", { name: t("workbench.title") });
}

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function topSave(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
}

function topPublish(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.publish")),
  });
}

function topCancel(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.cancel-changes")),
  });
}

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: t("document.headerField.name"),
  }) as HTMLInputElement;
}

/**
 * 点一次预设色板 = 改一处**版式**。
 *
 * 四行颜色各有一块同名色块（读屏名就是颜色名），按 role 查会命中多颗；这里要的只是
 * "改一处版式"，改哪一行都一样。
 */
function pickSwatch(): void {
  fireEvent.click(screen.getAllByRole("button", { name: t("workbench.color.navy") })[0]);
}

/** 改版式并等到"有改动"信号出现（顶部出现保存按钮）。 */
async function changeLayout(): Promise<void> {
  pickSwatch();
  await waitFor(() => expect(topSave()).not.toBeNull());
}

function closeButton(): HTMLElement {
  return within(actionbar()).getByRole("button", { name: t("common.action.close") });
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
