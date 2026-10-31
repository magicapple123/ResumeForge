// SPDX-License-Identifier: Apache-2.0
/**
 * W02 / A06 / R02：制作台的 409 冲突三选一（v2 文档模型）。
 *
 * 原 v1 版经旧 ResumeZoomModal 壳验证；旧壳删除后（Lead 拍板）改写到 V2 壳
 * （ResumeWorkbenchV2 + ResumeDetailPreview 真实宿主），行为断言不变：
 * - 冲突时保存按钮**禁用**（禁止再点一次硬覆盖）；
 * - 「用最新的」真的把服务端内容换回编辑器；
 * - 「比较差异」列出两边不同的字段（不是一句空提示）；
 * - 「另存副本」走宿主的 `documentPipeline.saveAsCopy`，内容取**本地 v2 文档**
 *   （标题拼接属于宿主职责；旧版断言的 `POST /resumes/manual` payload 由宿主的
 *   `saveAsCopy` 负责，V2 制作台只负责把本地文档交过去）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { t } from "../../i18n";
import { makeResumeDetail, makeResumeDocument } from "../../test/documentHarness";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeDetail, ResumeDocument, ResumeLayout } from "../../types";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import ResumeDetailPreview from "./ResumeDetailPreview";

const { getResumeMock } = vi.hoisted(() => ({ getResumeMock: vi.fn() }));

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));
// 冲突条自己调 getResume 读服务端最新（比较 / 用最新的）。
vi.mock("../../api/resumes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/resumes")>();
  return { ...actual, getResume: getResumeMock };
});

const LOCAL_NAME = "Alex";
const LATEST_NAME = "\u738b\u4e94";
const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

function documentWithName(name: string): ResumeDocument {
  const document = makeResumeDocument();
  const item = document.header.items.find((candidate) => candidate.key === "name");
  if (item) item.value = name;
  return document;
}

const DETAIL: ResumeDetail = {
  ...makeResumeDetail({ id: 42, title: "我的简历", revision: 3, language: "zh-CN" }),
  content: documentWithName(LOCAL_NAME),
};

/** 服务端"最新"那一版：名字被别处改成了「王五」，版本 4。 */
const LATEST: ResumeDetail = {
  ...DETAIL,
  revision: 4,
  content: documentWithName(LATEST_NAME),
};

const CONFLICT = new ApiError(
  "\u8fd9\u4efd\u7b80\u5386\u5df2\u88ab\u5176\u4ed6\u7a97\u53e3\u4fee\u6539",
  409,
  { code: "http", businessCode: "resume_revision_conflict" },
);

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: t("document.headerField.name"),
  }) as HTMLInputElement;
}

async function openWorkbench(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("workbench.title")) }));
  await screen.findByRole("dialog", { name: t("workbench.title") });
}

interface WorkbenchMocks {
  saveContent: ReturnType<typeof vi.fn>;
  saveAsCopy: ReturnType<typeof vi.fn>;
  adoptLatest: ReturnType<typeof vi.fn>;
}

function renderWorkbench(): WorkbenchMocks {
  const saveContent = vi.fn(async () => {
    throw CONFLICT;
  });
  const saveAsCopy = vi.fn(async () => LATEST);
  const adoptLatest = vi.fn(async () => undefined);
  const revision = 3;
  const pipeline: ResumeDocumentPipeline = {
    revision,
    saveLayout: vi.fn(async () => ({ status: "unchanged" as const, revision })),
    saveContent,
    publishDraft: vi.fn(async () => ({ status: "unchanged" as const, revision })),
    fetchLatest: getResumeMock,
    adoptLatest,
    saveAsCopy,
  };
  render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={DETAIL}
          html="<html></html>"
          layout={LAYOUT}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={{ current: null }}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={vi.fn(async () => undefined)}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
          documentPipeline={pipeline}
        />
      </AntdApp>
    </MemoryRouter>,
  );
  return { saveContent, saveAsCopy, adoptLatest };
}

/** 制造"内容脏"，点顶部保存，等冲突条出现。 */
async function triggerConflict(): Promise<void> {
  await openWorkbench();
  fireEvent.change(nameInput(), { target: { value: "\u674e\u56db" } });
  const saveButton = within(actionbar()).getByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
  await act(async () => {
    fireEvent.click(saveButton);
  });
  await screen.findByText(t("workbench.conflict.title"));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  getResumeMock.mockReset();
  getResumeMock.mockResolvedValue(LATEST);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台 · 409 冲突三选一", () => {
  it("冲突时给出三个动作，并禁用保存（不允许再点一次硬覆盖）", async () => {
    const { saveContent } = renderWorkbench();
    await triggerConflict();

    expect(saveContent).toHaveBeenCalled();
    for (const label of [
      t("workbench.conflict.action.use-latest"),
      t("workbench.conflict.action.compare"),
      t("workbench.conflict.action.save-copy"),
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    const saveButton = within(actionbar()).getByRole("button", {
      name: new RegExp(t("workbench.action.save-changes")),
    });
    expect(saveButton).toBeDisabled();
  });

  it("比较差异：逐字段列出你的版本与服务端最新", async () => {
    renderWorkbench();
    await triggerConflict();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("workbench.conflict.action.compare") }));
    });
    expect(getResumeMock).toHaveBeenCalledWith(42);
    // 本地那一侧「李四」、服务端最新那一侧「王五」都要出现在差异区，用户才能判断丢了什么。
    await screen.findByText(t("workbench.conflict.compare.local"));
    const diff = document.querySelector(".resume-wb-conflict-diff");
    expect(diff).not.toBeNull();
    expect(diff?.textContent).toContain("\u674e\u56db");
    expect(diff?.textContent).toContain(LATEST_NAME);
    expect(screen.getByText(t("workbench.conflict.compare.latest"))).toBeInTheDocument();
  });

  it("另存副本：把本地 v2 文档交给宿主 saveAsCopy，原记录同步成最新", async () => {
    const { saveAsCopy, adoptLatest } = renderWorkbench();
    await triggerConflict();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: t("workbench.conflict.action.save-copy") }),
      );
    });
    expect(saveAsCopy).toHaveBeenCalledTimes(1);
    const payload = saveAsCopy.mock.calls[0][0] as ResumeDocument;
    // 内容取的是**本地那份**（李四），不是服务端已保存的 Alex。
    const name = payload.header.items.find((item) => item.key === "name")?.value;
    expect(name).toBe("\u674e\u56db");

    // 副本建好后原记录同步成最新：冲突条收起，编辑器换成服务端那一版。
    await waitFor(() => expect(screen.queryByText(t("workbench.conflict.title"))).toBeNull());
    expect(adoptLatest).toHaveBeenCalled();
    await waitFor(() => expect(nameInput().value).toBe(LATEST_NAME));
  });

  it("用最新的：GET 最新版本覆盖本地并清掉冲突态", async () => {
    const { adoptLatest } = renderWorkbench();
    await triggerConflict();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: t("workbench.conflict.action.use-latest") }),
      );
    });
    expect(getResumeMock).toHaveBeenCalledWith(42);
    expect(adoptLatest).toHaveBeenCalledWith(LATEST);
    await waitFor(() => expect(screen.queryByText(t("workbench.conflict.title"))).toBeNull());
    await waitFor(() => expect(nameInput().value).toBe(LATEST_NAME));
  });
});
