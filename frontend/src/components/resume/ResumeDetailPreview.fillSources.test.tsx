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
import { t } from "../../i18n";
import { legacyProfileToProjection } from "../../test/profileProjectionFixture";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { invalidateProjectionCache } from "../../features/profile-library/projectionCache";
import type { ResumeDetail, ResumeLayout } from "../../types";
import { makeResumeDocument } from "../../test/documentHarness";
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
const profileMocks = vi.hoisted(() => ({ getProfile: vi.fn(), getCurrentProjection: vi.fn() }));
vi.mock("../../api/profile", () => ({ getProfile: profileMocks.getProfile }));
// F4：候选改读当前组投影（共享缓存），不再读旧资料接口。
vi.mock("../../features/profile-library/api", () => ({
  getCurrentProjection: profileMocks.getCurrentProjection,
}));

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
  content: makeResumeDocument(),
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
  // 投影缓存是模块级的：每个用例换一个数据集作用域 + 主动失效，避免上一条用例的缓存/在飞
  // 请求影响"什么时候请求"的断言（真实应用切数据集是整页 reload）。
  window.localStorage.setItem("resumeforge:active-dataset", `test-${Math.random()}`);
  profileMocks.getCurrentProjection.mockReset();
  profileMocks.getCurrentProjection.mockResolvedValue(
    legacyProfileToProjection(PROFILE as unknown as import("../../types").Profile),
  );
  invalidateProjectionCache();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/**
 * v2 projection 契约探针：candidates 带 document_path（v2 路径）+ document_entry（该条目的原样
 * v2 JSON）。用它验证「从资料填入」在 workbench 中真实插入：新增一个普通字段 + 一个仅素材
 * （placement=hidden）字段，前者进文档、后者触发「仅素材不上纸面」提示。
 */
function projectionWithV2Candidate() {
  const education = DETAIL.content.sections.find((section) => section.key === "education");
  const entry = education?.entries[0];
  if (!education || !entry?.id) throw new Error("fixture missing education entry");
  const source = { section_key: "educations", field_id: "courses" };
  const courses = {
    kind: "field" as const,
    id: "fill_courses_1",
    key: "courses",
    label: "核心课程",
    value: "数据结构；操作系统",
    placement: "trail" as const,
    format: "text" as const,
    wrap: "none" as const,
    show_label: true,
    solo: false,
    source,
    body_style: "bullet" as const,
  };
  const material = {
    ...courses,
    id: "fill_material_1",
    key: "material_contact",
    label: "背调联系人",
    value: "王老师",
    placement: "hidden" as const,
    source: { section_key: "educations", field_id: "material_contact" },
  };
  // 投影里的源条目与当前文档**不同 id、不同内容**：模拟真实的「资料条目」→ 当前简历条目，
  // 这样合并才是"补空/补缺失"，而不是把同一份内容再灌一遍（那会被去重成 0 个字段）。
  const sourceEntry = { ...entry, id: "proj_edu_01", items: [courses, material] };
  const content = {
    ...DETAIL.content,
    sections: DETAIL.content.sections.map((section) =>
      section.key === "education" ? { ...section, entries: [sourceEntry] } : section,
    ),
  };
  return {
    content,
    candidates: [
      {
        section_key: "educations",
        section_name: "教育经历",
        entry_id: "profile_entry_1",
        title: "示例大学",
        subtitle: "软件工程",
        document_path: education.key + ".proj_edu_01",
        document_entry: sourceEntry,
      },
    ],
  } as unknown as import("../../features/profile-library/types").PaperProjectionOut;
}

describe("预览不再就地取资料候选", () => {
  // 「手动调整」入口删掉之后（2026-10-28），预览页本身不该再拉资料投影：
  // 候选只在制作台弹层打开时才取一次（那条口径在下面「制作台中栏」里守着）。
  it("页面挂载时不请求资料投影", async () => {
    renderPreview();
    await screen.findByRole("button", { name: /简历制作台/ });
    expect(profileMocks.getCurrentProjection).not.toHaveBeenCalled();
  });
});

describe("制作台中栏的资料填入候选", () => {
  /**
   * TODO(v2 补位, 2026-10-30): 暂缓——workbench 确认本批中栏的「从资料填入」入口未接线
   * （profile-facts 填入 v2 留到下一批）。接线后把 it.skip 改回 it 即可，断言原样保留。
   */
  it("中栏拿到同一份候选（不是只给弹窗开）", async () => {
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /简历制作台/ }));
    await screen.findByRole("dialog", { name: "简历制作台" });

    // v2 的「从资料填入」入口在中栏编辑器上方；候选按需取（点开菜单才请求投影）。
    const column = document.querySelector<HTMLElement>(".resume-wb-col-editor");
    expect(column).not.toBeNull();
    const menuButton = column?.querySelector<HTMLElement>(".anticon-import")?.closest("button");
    expect(menuButton).not.toBeNull();
    // 打开前不请求。
    expect(profileMocks.getCurrentProjection).not.toHaveBeenCalled();
    fireEvent.click(menuButton as HTMLElement);
    await waitFor(() => expect(profileMocks.getCurrentProjection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fillSummaryButton()).not.toBeNull());
  });

  it("v2 candidates 的 document_entry 能真实插入中栏条目（含仅素材提示）", async () => {
    renderPreview();
    fireEvent.click(screen.getByRole("button", { name: /简历制作台/ }));
    await screen.findByRole("dialog", { name: "简历制作台" });

    // 候选按需取：在打开菜单前把 projection 换成 v2 契约形状（document_path + document_entry）。
    profileMocks.getCurrentProjection.mockResolvedValue(projectionWithV2Candidate());
    const column = document.querySelector<HTMLElement>(".resume-wb-col-editor");
    expect(column).not.toBeNull();
    // 先切到「教育经历」页签：chip 数只统计当前页签里的字段（默认停在「基本信息」）。
    const tabs = column?.querySelectorAll<HTMLElement>('[data-document-editor] [role="tab"]') ?? [];
    expect(tabs.length).toBeGreaterThan(1);
    fireEvent.click(tabs[1]);
    await waitFor(() => expect(column?.textContent).toContain("清华大学"));
    const chipsBefore = column?.querySelectorAll("[data-document-path]").length ?? 0;
    const menuButton = column?.querySelector<HTMLElement>(".anticon-import")?.closest("button");
    expect(menuButton).not.toBeNull();
    fireEvent.click(menuButton as HTMLElement);
    await waitFor(() => expect(profileMocks.getCurrentProjection).toHaveBeenCalledTimes(1));

    const menuitem = await screen.findByRole("menuitem");
    fireEvent.click(menuitem);
    // 插入生效：中栏 chip 数增加（新增的普通字段 + 仅素材字段都是 item）。
    await waitFor(
      () => {
        const chipsAfter = column?.querySelectorAll("[data-document-path]").length ?? 0;
        expect(chipsAfter).toBeGreaterThan(chipsBefore);
      },
      { timeout: 5000 },
    );
    // 成功反馈：toast 说清填了几个字段（不静默失败；具体数量由组件按真实写入数给）。
    await waitFor(() => expect(document.body.textContent).toContain("已从资料填入"), {
      timeout: 5000,
    });
    // 仅素材字段按契约给「不会印到纸面」的提示。
    await waitFor(() =>
      expect(screen.getByText(t("document.toast.materialOnly"))).toBeInTheDocument(),
    );
    expect(column?.textContent).toContain("数据结构");
  });
});
