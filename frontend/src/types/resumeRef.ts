// SPDX-License-Identifier: Apache-2.0
/**
 * `ResumeRef`：**同一份下拉里同时表达内部简历与外部简历**的复合引用（契约
 * `CONTRACT.md` 第 2 节，R14 落第一批消费方）。
 *
 * 为什么不能用一个 `number`：`resume_record`（内部简历）与 `external_resume`（外部简历）
 * 是两张表，id 各自从 1 开始，**会撞号**。裸数字当值的话，`3` 可能指内部第 3 份、也可能
 * 指外部第 3 份，保存时拆错字段就是把"这次跟进哪一份简历"记成别人。所以值域是复合串
 * `internal:12` / `external:7`，落到请求体时**再拆回两个独立的 id 字段**（后端仍按
 * `resume_id` / `external_resume_id` 两个互斥字段存，不让复合串流进协议）。
 *
 * 兼容旧写法：模拟面试与进度页早在用 `r:<id>` / `e:<id>`，解析时按同义处理；
 * 但 :func:`encodeResumeRef` **只产出新写法**（旧前缀只进不出，避免两套写法继续扩散）。
 */

/** 简历来源：内部（`resume_record`）/ 外部（`external_resume`）。 */
export type ResumeKind = "internal" | "external";

/** 一次简历引用：哪张表 + 那张表里的 id。 */
export interface ResumeRef {
  kind: ResumeKind;
  id: number;
}

/** 新旧前缀 → 来源。旧写法只在这里被读到，不会被写出去。 */
const KIND_BY_PREFIX: Record<string, ResumeKind> = {
  internal: "internal",
  external: "external",
  r: "internal",
  e: "external",
};

/** 拆「两个 id 字段」时的结果：**恰好一个非空**（或两个都空）。 */
export interface ResumeRefIds {
  resume_id: number | null;
  external_resume_id: number | null;
}

/** `{kind: "external", id: 7}` → `"external:7"`。 */
export function encodeResumeRef(ref: ResumeRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * `"internal:12"` / `"r:12"` → `{kind: "internal", id: 12}`；任何不合法的串一律 `null`。
 *
 * 不抛错是刻意的：这个函数的输入来自 URL 参数、表单旧值与后端回显，脏数据只该让
 * 下拉退回"未选择"，不该让整个面板白屏。
 */
export function decodeResumeRef(value: string | null | undefined): ResumeRef | null {
  const text = (value ?? "").trim();
  const separator = text.indexOf(":");
  if (separator <= 0) return null;
  const kind = KIND_BY_PREFIX[text.slice(0, separator).toLowerCase()];
  if (!kind) return null;
  const idText = text.slice(separator + 1);
  // 只认纯数字：`internal:3x` / `internal:-1` / `internal:3.5` 都不是合法 id。
  if (!/^\d+$/.test(idText)) return null;
  const id = Number(idText);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { kind, id };
}

/**
 * 记录上的两个关联字段 → 复合值；都没有则 `undefined`（= 下拉未选择）。
 *
 * 外部优先：两字段**互斥**（后端 422 守着），真的同时有值只可能来自手工改库 / 旧快照，
 * 此时按"外部"显示——与 tracker 的 `trackResumeRef` 同一取舍，两处不能各显示一套。
 */
export function resumeRefValue(record: {
  resume_id?: number | null;
  external_resume_id?: number | null;
}): string | undefined {
  if (record.external_resume_id != null) {
    return encodeResumeRef({ kind: "external", id: record.external_resume_id });
  }
  if (record.resume_id != null) {
    return encodeResumeRef({ kind: "internal", id: record.resume_id });
  }
  return undefined;
}

/**
 * 复合值 → 请求体的两个字段（**恰一个非空**）。
 *
 * 提交时两个键**都要给**：PATCH 是"显式给出才改"，只给外部 id 会让库里的内部 id 留着，
 * 合并后变成"两个都关联"（后端 422）。两个都写，才能表达"从内部改选到外部"。
 */
export function resumeRefIds(value: string | null | undefined): ResumeRefIds {
  const ref = decodeResumeRef(value);
  if (ref === null) return { resume_id: null, external_resume_id: null };
  return ref.kind === "internal"
    ? { resume_id: ref.id, external_resume_id: null }
    : { resume_id: null, external_resume_id: ref.id };
}
