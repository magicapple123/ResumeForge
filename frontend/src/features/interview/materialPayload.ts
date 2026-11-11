// SPDX-License-Identifier: Apache-2.0
/**
 * 「表单值 → 写请求体」的材料投影（问题 5）。
 *
 * 上传端点返回的是**读取 DTO**（`{name, text, warnings}`），警告是给界面上的警告条
 * 用的；写端点 `POST /api/interview` 收的是 `{name, text}` 且 `extra="forbid"`。
 * 把读取结果整份塞进请求体，两侧各报一条「包含不支持的字段」，面试直接开不起来
 * （`SetupTab` 的 state 保留 `warnings` 没有错，错在提交时没有在边界上收口）。
 *
 * TypeScript 拦不住这件事：变量赋值不做「多余属性检查」（那只对对象字面量生效），
 * 带 `warnings` 的对象在结构上可以赋给 `{name, text}`。所以这里用**唯一的投影函数**
 * 把"哪些字段能进请求体"写成一处显式代码——将来给 DTO 加字段时，写端点那边自动安全。
 *
 * 同类的坑在 `PUT /api/apply/config` 上已经踩过一次（把 GET 的 `defaults` 回传 → 422），
 * 决策与理由见 `docs/architecture.md` 的决策表。
 */
import { parseResumeValue } from "../../hooks/useInterviewResumeSelect";
import type { InterviewMaterialExtract, InterviewMaterialPayload } from "../../types";

/** 只挑写端点接受的字段；没有材料时返回 `undefined`（JSON 序列化后即缺省）。 */
export function toMaterialPayload(
  material: InterviewMaterialExtract | null | undefined,
): InterviewMaterialPayload | undefined {
  return material ? { name: material.name, text: material.text } : undefined;
}

/**
 * 「关联简历」的表单值 → 写端点的 `resume_id`（#25）。同一个边界上的第二个投影。
 *
 * 下拉的 value 是带前缀的字符串：`r:12` 才是内部简历的 id；`e:7`（外部简历）**没有**内部
 * id —— 它的正文由 `resume_material` 承载，这里给 `undefined`。少走这一步会把 `"r:12"`
 * 当数字发出去（TS 拦得住）或静默发 `undefined`（拦不住，界面上还显示"已选"）。
 */
export function toInternalResumeId(raw: string | null | undefined): number | undefined {
  const parsed = parseResumeValue(raw);
  return parsed?.kind === "internal" ? parsed.id : undefined;
}
