// SPDX-License-Identifier: Apache-2.0
/**
 * F4 §5.7 / R-27：生成弹窗**只读**当前组摘要，没有选组器；
 * 「完整使用你的资料」这类旧文案改成"当前组参与的大字段"口径。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectionOf } from "../test/profileProjectionFixture";
import GenerationConfigStage, {
  MAX_CUSTOM_INSTRUCTION,
} from "./generate-resume/GenerationConfigStage";

const projectionState = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as Error | null,
  reload: vi.fn(),
}));

vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => projectionState,
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
// 配置页里与组摘要无关的三个重控件：本文件只验证摘要/文案，不重复测它们。
vi.mock("../features/career-scenarios/GenerationScenarioControl", () => ({
  default: () => null,
}));
vi.mock("../ResumeLayoutControls", () => ({ default: () => null }));
vi.mock("./common/MaxLengthHint", () => ({ MaxLengthHint: () => null }));

const baseProps = {
  job: null,
  title: "",
  setTitle: vi.fn(),
  generation: {
    documentMode: "resume" as const,
    setDocumentMode: vi.fn(),
    resetExtras: vi.fn(),
    careerContext: null,
    setCareerContext: vi.fn(),
  },
  enhance: false,
  setEnhance: vi.fn(),
  enhancementLevel: "balanced" as const,
  setEnhancementLevel: vi.fn(),
  layout: { template: "classic", format_name: "", page_limit: 1, font_scale: "standard" as const },
  setLayout: vi.fn(),
  customInstruction: "",
  setCustomInstruction: vi.fn(),
  llmReady: true,
  modelName: "deepseek-chat",
  onClose: vi.fn(),
  onStart: vi.fn(),
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

beforeEach(() => {
  projectionState.data = projectionOf({
    keys: ["basic_info", "education", "experience", "projects", "skills", "awards", "summary"],
    groupName: "默认组",
    content: { name: "张三", job_intent: "前端开发", summary: "个人总结" },
  });
  projectionState.loading = false;
  projectionState.error = null;
  projectionState.reload.mockReset();
});

// 同 ManualResumeModal.groups.test：中文只放常量，ByText 断言参数不计入棘轮。
const TITLE_TEXT = "本次使用";
const GROUP_NAME = /默认组/;
const GROUP_COUNT = /7 个大字段/;
const OLD_COPY = /完整使用你的资料/;
const CURRENT_GROUP_COPY = /当前组参与的大字段/;
const SWITCH_TEXT = "去切换组";
const FAILED_TEXT = "当前组信息读取失败";
const START_TEXT = "开始生成";

describe("GenerateResumeModal 组摘要（F4-D）", () => {
  it("只读显示当前组与参与大字段数，没有选组器", () => {
    render(
      <AntdApp>
        <GenerationConfigStage {...baseProps} />
      </AntdApp>,
    );
    expect(screen.getByText(TITLE_TEXT)).toBeInTheDocument();
    expect(screen.getByText(GROUP_NAME)).toBeInTheDocument();
    expect(screen.getByText(GROUP_COUNT)).toBeInTheDocument();
    // 没有选组器：页面里没有以"组"为名的下拉（条目候选下拉只在编辑器里）。
    expect(screen.queryByRole("combobox", { name: /组/ })).not.toBeInTheDocument();
    // 旧文案「完整使用你的资料」必须消失，改成当前组口径。
    expect(screen.queryByText(OLD_COPY)).not.toBeInTheDocument();
    expect(screen.getByText(CURRENT_GROUP_COPY)).toBeInTheDocument();
  });

  it("「去切换组」入口存在（只跳资料页，不在生成面板里换组）", () => {
    render(
      <AntdApp>
        <GenerationConfigStage {...baseProps} />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: SWITCH_TEXT })).toBeInTheDocument();
  });

  it("读取失败不阻断生成：显示原因 + 重试", () => {
    projectionState.data = null;
    projectionState.error = new Error("网络错误");
    render(
      <AntdApp>
        <GenerationConfigStage {...baseProps} />
      </AntdApp>,
    );
    expect(screen.getByText(FAILED_TEXT)).toBeInTheDocument();
    // antd 会给两字中文按钮加空格（"重 试"），按正则可访问名断言。
    expect(screen.getByRole("button", { name: /重\s?试/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: START_TEXT })).toBeInTheDocument();
  });

  it("自定义提示词上限常量仍与后端一致（不漏生成参数）", () => {
    expect(MAX_CUSTOM_INSTRUCTION).toBe(2000);
  });
});
