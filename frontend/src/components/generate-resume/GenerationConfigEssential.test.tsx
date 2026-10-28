// SPDX-License-Identifier: Apache-2.0
/**
 * 生成配置只暴露 5 个「篇幅与版式」参数（文档模式 / 模板 / 最大篇幅 / 简历语言 / 字体），
 * 其余版式留给用户**生成之后**去简历界面调。
 *
 * 产品原话：「用户在岗位广场生成简历时，篇幅与版式只能指定文档模式、模板、最大篇幅、
 * 简历语言、字体这些参数，其余的参数等简历生成好了之后用户再去简历界面调整」；后来又
 * 补了一句同样适用于**通用简历生成**——所以两条入口现在共用同一套收敛规则
 * （`essentialOnly` 恒为 true），这里两个入口都断言。
 *
 * 这里**直接渲染 `GenerationConfigStage`**（而不是整个弹窗）：被测的是"这块区域渲染了
 * 哪些控件"，弹窗的取数/轮询链路另有 `GenerateResumeModal.*.test.tsx` 守着。
 * 断言一律用 `t()` 取文案（测试里的中文断言同样计入 i18n 存量棘轮）。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, ResumeLayout } from "../../types";
import { t } from "../../i18n";
import GenerationConfigStage from "./GenerationConfigStage";

const JOB: Job = {
  id: 3,
  title: "后端开发工程师",
  company: "示例公司",
  location: "",
  salary: "",
  job_type: "社招",
  description: "负责服务端接口",
  requirements: "",
  additional_info: "",
  keywords: [],
  source: "手动添加",
  source_url: "",
  posted_at: "",
  status: "开放中",
  note: "",
  note_images: [],
  favorite: false,
  recognition_source: "",
  origin_source: "",
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
} as ResumeLayout;

/** 生成配置阶段是纯展示受控组件：所有状态从外面灌进来。 */
function renderStage(job: Job | null) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <GenerationConfigStage
          job={job}
          title=""
          setTitle={vi.fn()}
          generation={{
            documentMode: "resume",
            setDocumentMode: vi.fn(),
            careerContext: null,
            setCareerContext: vi.fn(),
            resetExtras: vi.fn(),
          }}
          enhance={false}
          setEnhance={vi.fn()}
          enhancementLevel="balanced"
          setEnhancementLevel={vi.fn()}
          layout={LAYOUT}
          setLayout={vi.fn()}
          customInstruction=""
          setCustomInstruction={vi.fn()}
          llmReady
          modelName="test-model"
          onClose={vi.fn()}
          onStart={vi.fn()}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 该文案在页面上是否出现（用 `t()` 取语言包，避免新增中文字面量断言）。 */
function shows(key: Parameters<typeof t>[0]): boolean {
  return screen.queryByText(t(key)) !== null;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** 只应出现在「缩小范围」之外的 4 项（模板 / 最大篇幅 / 简历语言 / 字体）。 */
const KEPT = [
  "sections.templateControls.templateLabel",
  "sections.templateControls.pageLimitLabel",
  "resume.language.label",
  "resume.measure.fontLabel",
] as const;

/** 两个入口都不该出现的其余版式项。 */
const HIDDEN = [
  "sections.templateControls.formatLabel",
  "sections.templateControls.sectionsLabel",
  "resume.measure.fontSize",
  "resume.lineHeight.label",
  "resume.pagePadding.label",
  "resume.photo.scale.label",
] as const;

describe("GenerationConfigStage 的篇幅与版式范围", () => {
  it("岗位广场（job 非空）：只剩模板 / 最大篇幅 / 简历语言 / 字体", () => {
    renderStage(JOB);

    for (const key of KEPT) {
      expect(shows(key), `${key} 应当保留`).toBe(true);
    }
    for (const key of HIDDEN) {
      expect(shows(key), `${key} 不该出现`).toBe(false);
    }
  });

  it("通用简历生成（job 为空）：同样只留这 5 个参数", () => {
    renderStage(null);

    for (const key of KEPT) {
      expect(shows(key), `${key} 应当保留`).toBe(true);
    }
    for (const key of HIDDEN) {
      expect(shows(key), `${key} 不该出现`).toBe(false);
    }
  });

  it("说明文案统一说「生成后再调」", () => {
    renderStage(null);

    expect(shows("generate.config.layoutHintEssential")).toBe(true);
    expect(shows("generate.config.layoutHint")).toBe(false);
  });
});
