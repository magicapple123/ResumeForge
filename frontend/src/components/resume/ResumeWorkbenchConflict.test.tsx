// SPDX-License-Identifier: Apache-2.0
/**
 * W02 / A06 / R02：制作台的 409 冲突三选一。
 *
 * 这里钉的是"真实可用"而不是"按钮存在"：
 * - 冲突时保存按钮**禁用**（禁止再点一次硬覆盖）；
 * - 「用最新的」真的把服务端内容换回编辑器；
 * - 「比较差异」列出两边不同的字段（不是一句空提示）；
 * - 「另存副本」真的调 `POST /resumes/manual`（draft=false、标题带（副本）、内容取本地）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { t } from "../../i18n";
import { ApiError } from "../../api/client";
import type { ResumeContent, ResumeDetail, ResumeLanguage } from "../../types";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

const { getResumeMock, createManualResumeMock } = vi.hoisted(() => ({
  getResumeMock: vi.fn(),
  createManualResumeMock: vi.fn(),
}));

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));
// 冲突条自己调这两条接口：获取最新版本（比较 / 用最新的）与另存副本。
vi.mock("../../api/resumes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/resumes")>();
  return { ...actual, getResume: getResumeMock, createManualResume: createManualResumeMock };
});

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

const LAYOUT = { ...DEFAULT_LAYOUT, format_config: {} };

/** 服务端"最新"那一版：名字被别处改成了「王五」，版本 4。 */
const LATEST: ResumeDetail = {
  id: 42,
  title: "\u6211\u7684\u7b80\u5386",
  job_id: null,
  job_title: "",
  company: "",
  source: "manual",
  favorite: false,
  note: "",
  model: "",
  enhancement_enabled: false,
  enhancement_level: "light",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
  created_at: "2026-10-24T00:00:00",
  updated_at: null,
  revision: 4,
  content: { ...CONTENT, name: "\u738b\u4e94" },
  warnings: [],
  parse_error: "",
  parent_revision_id: null,
  rationale: "",
  coverage_notes: [],
  fact_annotations: [],
  draft: false,
};

const CONFLICT = new ApiError(
  "\u8fd9\u4efd\u7b80\u5386\u5df2\u88ab\u5176\u4ed6\u7a97\u53e3\u4fee\u6539",
  409,
  {
    code: "http",
    businessCode: "resume_revision_conflict",
  },
);

function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function renderWorkbench(language: ResumeLanguage = "zh-CN") {
  const saveContent = vi.fn(async () => {
    throw CONFLICT;
  });
  function Harness() {
    const [content, setContent] = useState<ResumeContent>(CONTENT);
    const [revision, setRevision] = useState(3);
    const pipeline: ResumeDocumentPipeline = {
      revision,
      saveLayout: vi.fn(async () => ({ status: "unchanged" as const, revision })),
      saveContent,
      publishDraft: vi.fn(async () => ({ status: "unchanged" as const, revision })),
      fetchLatest: getResumeMock,
      adoptLatest: async (latest: ResumeDetail) => {
        setContent(latest.content);
        setRevision(latest.revision ?? 0);
      },
      saveAsCopy: createManualResumeMock,
    };
    return (
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={vi.fn()}
          layout={LAYOUT}
          resumeId={42}
          resumeTitle={"我的简历"}
          resumeLanguage={language}
          content={content}
          onApplyLayout={vi.fn()}
          onSaveContent={vi.fn(async () => 3)}
          documentPipeline={pipeline}
        />
      </AntdApp>
    );
  }
  render(<Harness />);
  return { saveContent };
}

/** 制造"内容脏"，点顶部保存，等冲突条出现。 */
async function triggerConflict(): Promise<void> {
  fireEvent.change(nameInput(), { target: { value: "\u674e\u56db" } });
  const saveButton = await within(actionbar()).findByRole("button", {
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
  createManualResumeMock.mockReset();
  getResumeMock.mockResolvedValue(LATEST);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
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
    // 本地那一侧「李四」、服务端最新那一侧「王五」都要出现，用户才能判断丢了什么。
    await screen.findByText("\u674e\u56db");
    expect(screen.getByText("\u738b\u4e94")).toBeInTheDocument();
    expect(screen.getByText(t("workbench.conflict.compare.local"))).toBeInTheDocument();
    expect(screen.getByText(t("workbench.conflict.compare.latest"))).toBeInTheDocument();
  });

  it("另存副本：调 createManualResume（draft=false、标题带（副本）、内容取本地）", async () => {
    const copy = {
      ...LATEST,
      id: 77,
      title: "\u6211\u7684\u7b80\u5386\uff08\u526f\u672c\uff09",
      revision: 0,
      language: "en-US" as const,
    };
    createManualResumeMock.mockResolvedValue(copy);
    renderWorkbench("en-US");
    await triggerConflict();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: t("workbench.conflict.action.save-copy") }),
      );
    });
    expect(createManualResumeMock).toHaveBeenCalledTimes(1);
    const payload = createManualResumeMock.mock.calls[0][0] as {
      title: string;
      content: ResumeContent;
      draft: boolean;
      language: string;
    };
    expect(payload.title).toBe(
      t("workbench.conflict.copy.title", { title: "\u6211\u7684\u7b80\u5386" }),
    );
    expect(payload.draft).toBe(false);
    expect(payload.language).toBe("en-US");
    // 内容取的是**本地那份**（李四），不是服务端已保存的 Alex。
    expect(payload.content.name).toBe("\u674e\u56db");

    // 副本建好后原记录同步成最新：冲突条收起，编辑器换成服务端那一版。
    await waitFor(() => expect(screen.queryByText(t("workbench.conflict.title"))).toBeNull());
    await waitFor(() => expect(nameInput().value).toBe("\u738b\u4e94"));
  });

  it("用最新的：GET 最新版本覆盖本地并清掉冲突态", async () => {
    renderWorkbench();
    await triggerConflict();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: t("workbench.conflict.action.use-latest") }),
      );
    });
    expect(getResumeMock).toHaveBeenCalledWith(42);
    await waitFor(() => expect(screen.queryByText(t("workbench.conflict.title"))).toBeNull());
    await waitFor(() => expect(nameInput().value).toBe("\u738b\u4e94"));
  });
});
