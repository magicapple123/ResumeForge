// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览 · **「从我的资料追加一条」的接线**（P0）。
 *
 * 新建简历（`ManualResumeModal`）里每个模块都有这条入口，而编辑**已保存**简历的
 * 「手动调整」与制作台中栏一直都没有——根因不是组件缺能力，是调用点没把候选传下去
 * （`ResumeEditorModal` 的这条入口是"不传就完全不渲染"）。这类断链只有**调用点**这一层
 * 的用例抓得住，所以与主文件分开放（两份各自 <500 行预算）。
 *
 * 两条额外的口径：候选**按需**取（不在页面挂载时请求），且资料接口失败时必须静默降级
 * ——编辑器照常打开，只是没有这条入口。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeDetail, ResumeLayout } from "../../types";
import ResumeDetailPreview from "./ResumeDetailPreview";

/** 预览与版式控件与本用例无关：替成桩，省掉 iframe 与目录请求。 */
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="preview-stub" />,
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("./ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("./ResumeMeasureControls", () => ({ default: () => null }));
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));

/** `/profile`：既要钉住"什么时候请求"，也要钉住"请求失败不挡编辑器"。 */
const profileMocks = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("../../api/profile", () => ({ getProfile: profileMocks.getProfile }));

/** 只要让 `profileToResumeContent` 走得通：六个列表空数组 + 一句个人总结。 */
const PROFILE = {
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "Backend engineer, five years.",
  educations: [],
  experiences: [],
  campus_experiences: [],
  projects: [],
  skills: [],
  awards: [],
};

const DETAIL: ResumeDetail = {
  id: 42,
  title: "backend",
  job_id: null,
  job_title: "",
  company: "",
  source: "ai",
  favorite: false,
  note: "",
  model: "demo-model",
  enhancement_enabled: false,
  enhancement_level: "balanced",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-09-20T08:00:00",
  content: {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  },
  warnings: [],
  parse_error: "",
  rationale: "",
  parent_revision_id: null,
  coverage_notes: [],
};

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

function renderPreview() {
  return render(
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
          onSaveEditedResume={vi.fn()}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 资料里「个人总结」的填入按钮：用图标类名定位而不是按文案——那个按钮的文字是存量
 * 硬编码，而 `cjkRatchet` 的 tests 口径会把新增的中文 `getByText` 计入存量。
 */
function fillSummaryButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLElement>(".anticon-import")?.closest("button") ?? null;
}

beforeEach(() => {
  profileMocks.getProfile.mockResolvedValue(PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("「手动调整」的资料填入候选", () => {
  it("资料只在打开编辑器之后才取一次，不在页面挂载时请求", async () => {
    renderPreview();
    expect(profileMocks.getProfile).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /手动调整/ }));

    await waitFor(() => expect(profileMocks.getProfile).toHaveBeenCalledTimes(1));
    // 入口出现 = `fillSources` 真的传到了编辑器。
    await waitFor(() => expect(fillSummaryButton()).not.toBeNull());
  });

  it("资料接口失败时编辑器照常打开，只是没有这条入口（静默降级）", async () => {
    profileMocks.getProfile.mockRejectedValueOnce(new Error("profile down"));
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: /手动调整/ }));

    await waitFor(() => expect(profileMocks.getProfile).toHaveBeenCalled());
    // 编辑器本体可用：`Form.Item name="name"` 渲染出的输入框 id 就是字段名。
    await waitFor(() => expect(document.getElementById("name")).not.toBeNull());
    expect(fillSummaryButton()).toBeNull();
  });
});

describe("制作台中栏的资料填入候选", () => {
  it("中栏拿到同一份候选（不是只给弹窗开）", async () => {
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /简历制作台/ }));
    await screen.findByRole("dialog", { name: "简历制作台" });

    await waitFor(() => expect(profileMocks.getProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fillSummaryButton()).not.toBeNull());
    // 入口出现在中栏里，而不是落在外面的弹窗里。
    const column = document.querySelector(".resume-wb-col-editor");
    expect(column?.querySelector(".anticon-import")).not.toBeNull();
  });
});
