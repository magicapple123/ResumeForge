// SPDX-License-Identifier: Apache-2.0
/**
 * 版式接口：调整 / 诊断 / 渲染。
 *
 * 从 `resumes.ts` 拆出（单文件 500 行预算）。这三条是同一个域——回答的都是"这份简历
 * 怎么排"，与简历本身的新增/改名/删除不是一回事，拆开后两边都能继续长。
 *
 * `resumes.ts` 仍 re-export 这三个函数：既有导入路径（以及测试里
 * `vi.mock("../api/resumes")` 的落点）一个都不动。
 */
import type {
  ResumeDocument,
  ResumeDetail,
  ResumeLayout,
  ResumeLayoutAnalysis,
  ResumeLayoutMeasure,
} from "../types";
import { request, requestRaw } from "./client";

/** 只调整版式参数（模板/页数/字号），不重新生成内容。 */
export function updateResumeLayout(id: number, layout: ResumeLayout): Promise<ResumeDetail> {
  return request(`/resumes/${id}/layout`, {
    method: "PATCH",
    body: JSON.stringify(layout),
  });
}

/**
 * 版面诊断：把预览里量到的两个高度 + **屏幕上这一版**的草稿版式发过去，拿回结论与逐档收紧方案。
 *
 * 规则全在后端（多少算满、先动哪个旋钮、字号缩到哪为止），前端只负责量准和呈现。
 *
 * 版式必须一起传：`fit_room` / `fit_ladder` 是"从当前版式再往紧收一档"算出来的。只发测量值
 * 的话，后端只能拿**已保存**的记录值当基准——拖完滑块还没保存时，诊断说的就是另一个版式
 * （表现为改参数、诊断面板整块不动）。
 */
export function analyzeResumeLayout(
  id: number,
  measure: ResumeLayoutMeasure,
  layout?: Partial<ResumeLayout>,
): Promise<ResumeLayoutAnalysis> {
  return request(`/resumes/${id}/layout/analyze`, {
    method: "POST",
    body: JSON.stringify({
      measure,
      // 不传 = 后端回落到记录值（`extra="forbid"`，多塞字段会被 422）。
      template: layout?.template,
      format_name: layout?.format_name,
      font_scale: layout?.font_scale,
      format_config: layout?.format_config,
    }),
  });
}

/**
 * 渲染简历内容为 HTML（生成完成后、落库前的即时预览）。
 *
 * `signal` 只给「制作台实时预览」用：连续输入会连发几次，前一次的结果已经没有意义时应当
 * 真的取消（而不是等它回来再丢弃）。缺省不传 = 行为与之前逐字相同。
 */
export async function renderResume(
  content: ResumeDocument,
  layout: Partial<ResumeLayout> & { document_mode?: "resume" | "long_cv" } = {},
  signal?: AbortSignal,
): Promise<string> {
  const resp = await requestRaw("/resumes/render", {
    method: "POST",
    budget: "task",
    signal,
    headers: { "Content-Type": "application/json" },
    // 后端 ResumeRenderRequest 的结构是 { content, template, page_limit, font_scale }。
    body: JSON.stringify({ content, ...layout }),
  });
  return resp.text();
}
