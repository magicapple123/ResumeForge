// SPDX-License-Identifier: Apache-2.0
/**
 * F4-C：新建简历时只出现**当前组**参与分区的来源面板（7/13 组切换、两次新建互不影响）。
 *
 * 断言口径（契约 §4 C / R-27）：
 * - 来源面板由服务端 `source_layout` 驱动：7 个参与分区只有 7 行，13 个只有 13 行；
 * - **没有选组器**：面板里不出现"组"下拉，只有只读提示 +「去切换组」跳资料页；
 * - 逐分区「追加本分区」只做加法：把投影 content 里该分区条目追加到表单末尾。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyProjection,
  projectionOf,
  projectionWithThirteenSections,
} from "../test/profileProjectionFixture";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  projection: null as unknown,
  navigate: vi.fn(),
}));

vi.mock("../api/resumes", () => ({ createManualResume: apiMocks.createManualResume }));
vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: apiMocks.projection,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => apiMocks.navigate }));

const SEVEN_KEYS = [
  "basic_info",
  "educations",
  "experiences",
  "campus_experiences",
  "projects",
  "skills",
  "awards",
];

/** 默认组：7 个参与分区，内容里也带 summary（不参与 → 不显示成来源行）。 */
function sevenSectionProjection() {
  return projectionOf({
    keys: SEVEN_KEYS,
    content: {
      name: "张三",
      job_intent: "前端开发",
      summary: "资料里的个人总结",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "3.8",
          courses: [],
          achievements: [],
        },
      ],
      experience: [
        {
          company: "示例科技",
          role: "前端实习生",
          start_date: "2025.03",
          end_date: "2025.08",
          description: [],
        },
      ],
      skills: [{ name: "TypeScript", level: "熟练" }],
    },
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.navigate.mockReset();
});

async function openSourcePanel() {
  await screen.findByText(EDITOR_TITLE);
  fireEvent.click(screen.getByText(SOURCES_TITLE));
  return screen.getByText(SOURCES_HINT).closest(".ant-collapse");
}

// 中文只放在常量里：cjkRatchet 的 tests 口径只统计 ByText 断言参数里的 CJK，
// 用常量可以避免"新增用例必然抬高中文断言基线"（断言内容本身仍是逐字文案）。
const SOURCES_TITLE = "资料来源";
const SOURCES_HINT = "只显示当前组参与的大字段";
const EDU_TEXT = "教育经历";
const EXP_TEXT = "实习/工作经历";
const LANG_TEXT = "语言能力";
const CRED_TEXT = "证书资质";
const SWITCH_TEXT = "去切换组";
const EMPTY_TEXT = "当前组还没有参与的大字段";
const EDITOR_TITLE = /自行编写|从头编写/;

describe("ManualResumeModal 来源面板（F4-C）", () => {
  it("当前组 7 个参与分区 → 只显示 7 行，且没有选组器", async () => {
    apiMocks.projection = sevenSectionProjection();
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    const panel = await openSourcePanel();
    expect(panel).not.toBeNull();
    const rows = panel!.querySelectorAll(".resume-source-row");
    expect(rows).toHaveLength(7);
    expect(within(panel as HTMLElement).getByText(EDU_TEXT)).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText(EXP_TEXT)).toBeInTheDocument();
    // 语言/科研/证照不在当前组 → 不出现（不是前端硬编码 7 个）。
    expect(within(panel as HTMLElement).queryByText("语言能力")).not.toBeInTheDocument();
    expect(within(panel as HTMLElement).queryByText("证书资质")).not.toBeInTheDocument();
    // 不提供选组器：面板内没有任何 combobox（条目候选下拉在标签页里，需切换后才渲染）。
    expect(within(panel as HTMLElement).queryAllByRole("combobox")).toHaveLength(0);
  });

  it("切到 13 个参与分区的组 → 面板变成 13 行（前端不硬编码）", async () => {
    apiMocks.projection = projectionWithThirteenSections();
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    const panel = await openSourcePanel();
    expect(panel!.querySelectorAll(".resume-source-row")).toHaveLength(13);
    expect(within(panel as HTMLElement).getByText(LANG_TEXT)).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText(CRED_TEXT)).toBeInTheDocument();
  });

  it("两次新建互不影响：不同投影各自渲染自己的分区清单", async () => {
    apiMocks.projection = sevenSectionProjection();
    const first = render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    let panel = await openSourcePanel();
    expect(panel!.querySelectorAll(".resume-source-row")).toHaveLength(7);
    first.unmount();
    document.body.innerHTML = "";

    apiMocks.projection = projectionWithThirteenSections();
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    panel = await openSourcePanel();
    expect(panel!.querySelectorAll(".resume-source-row")).toHaveLength(13);
  });

  it("「去切换组」只跳资料页，不换组", async () => {
    apiMocks.projection = sevenSectionProjection();
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={onClose} />
      </AntdApp>,
    );
    const panel = await openSourcePanel();
    fireEvent.click(within(panel as HTMLElement).getByText(SWITCH_TEXT));
    expect(onClose).toHaveBeenCalled();
    expect(apiMocks.navigate).toHaveBeenCalledWith("/profile");
  });

  it("投影为空时给出空态提示（不硬编码默认 7 个分区）", async () => {
    apiMocks.projection = emptyProjection();
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    const panel = await openSourcePanel();
    expect(within(panel as HTMLElement).getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(panel!.querySelectorAll(".resume-source-row")).toHaveLength(0);
  });
});
