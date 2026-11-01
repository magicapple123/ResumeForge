// SPDX-License-Identifier: Apache-2.0
/**
 * 「生成简历」弹窗的请求体组装：配置页的散装状态 → `POST /resumes/generate/tasks`（纯映射）。
 *
 * 从 `GenerateResumeModal.tsx` 拆出——那个文件到 502 行，超 `tests/test_file_size_budget.py`
 * 的 500 行预算。拆出来的是**纯函数**：输入七个配置项，输出一份请求体，没有 hook、没有
 * 请求、没有 i18n；"哪些字段必发、哪些字段默认不发"的口径因此可以单独钉住，而弹窗那边
 * 只管发起与错误提示。
 *
 * 三条既有口径（搬过来时逐字保留）：
 *
 * 1. 岗位生成时 `title` 传空串：名称由后端按岗位命名，用户在配置页填的名称只对**通用简历**
 *    生效（`initialTitle`）；
 * 2. 生成时定下的版式覆盖必须跟着请求走（`format_config`），否则配置页调的顺序/字号只影响
 *    这次预览，关掉再从简历中心打开就变回去了；
 * 3. **默认不发送新字段**：`document_mode` / `career_context` 用条件展开，保证"未启用场景 +
 *    普通简历"的请求体与旧版逐字节相同。
 */
import type {
  EnhancementLevel,
  Job,
  ResumeLayout,
  StartResumeGenerationPayload,
} from "../../types";

/** 组装请求体需要的配置项（弹窗的 state 快照，字段名与 state 同名便于对读）。 */
export interface GenerateRequestInput {
  /** null = 生成通用简历。 */
  job: Job | null;
  /** 通用简历的名称；岗位生成时忽略（见口径 1）。 */
  title: string;
  enhance: boolean;
  enhancementLevel: EnhancementLevel;
  /** 生成开始时的版式快照（不是此刻的 `layout`——预览必须与请求一致）。 */
  layout: ResumeLayout;
  customInstruction: string;
  /** 本次生成专属上下文（默认值即"不发"）。 */
  generation: {
    documentMode: "resume" | "long_cv";
    careerContext: StartResumeGenerationPayload["options"]["career_context"];
  };
}

/**
 * 把配置页状态拼成生成请求体。
 *
 * @param input 弹窗的配置快照。
 * @returns 可直接交给 `startResumeGeneration` 的请求体。
 */
export function buildGenerateRequest(input: GenerateRequestInput): StartResumeGenerationPayload {
  const { job, title, enhance, enhancementLevel, layout, customInstruction, generation } = input;
  return {
    job_id: job?.id ?? null,
    title: job ? "" : title.trim(),
    options: {
      enhance,
      enhancement_level: enhancementLevel,
      page_limit: layout.page_limit,
      font_scale: layout.font_scale,
      language: layout.language,
      template: layout.template,
      format_name: layout.format_name,
      // 条目 2：版式覆盖跟着请求走（否则只影响本次预览）。
      format_config: layout.format_config ?? {},
      custom_instruction: customInstruction.trim(),
      // 条目 3：两个条件展开保证"未启用场景 + 普通简历"的请求体与旧版逐字节相同。
      ...(generation.documentMode === "long_cv" ? { document_mode: "long_cv" as const } : {}),
      ...(generation.careerContext ? { career_context: generation.careerContext } : {}),
    },
  };
}
