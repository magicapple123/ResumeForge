// SPDX-License-Identifier: Apache-2.0
/**
 * W12-FE 的**纯规则**：来源/候选/用量/外发预览在界面上的派生逻辑。
 *
 * 组件的职责只有"画"与"发回调"，判断全在这里（可单测、无 React、无网络）：
 * 未关联判定、stale 过滤、候选状态合并、token 未知的表达、费用不可估算的表达、
 * 冲突业务码分类。
 */
import type {
  BlockLinkOut,
  CandidateMode,
  DocumentObjectOut,
  FactLockConflictOut,
  FactLockOut,
  FactLockViolationOut,
  ProvenanceCoverage,
  ResumeProvenanceOut,
  SourceOut,
  UsageBucketOut,
  UsageCostOut,
  WritingCandidateState,
} from "./types";
import type { ProvenanceMessageKey } from "./i18n";

/** 来源类型 → 文案 key。未知值按"手工登记"显示（不编造类别）。 */
export function sourceKindKey(kind: string): ProvenanceMessageKey {
  const known = ["claim", "material", "job", "profile", "manual"];
  const value = known.includes(kind) ? kind : "manual";
  return ("provenance.source.kind." + value) as ProvenanceMessageKey;
}

/** 事实锁类型 → 文案 key（未知值显示"其他"以外的兜底由组件处理）。 */
export function factLockKindKey(kind: string): ProvenanceMessageKey | null {
  const known = ["name", "institution", "time", "number", "responsibility_boundary"];
  if (!known.includes(kind)) return null;
  return ("provenance.lock.kind." + kind) as ProvenanceMessageKey;
}

/** 指纹短显示：前 8 位 + 省略号（只用于人眼对照，不参与逻辑）。 */
export function shortFingerprint(fingerprint: string): string {
  const value = (fingerprint || "").trim();
  if (value.length <= 8) return value;
  return value.slice(0, 8) + "…";
}

/** 某来源的最新修订（revisions 为空时返回 null）。 */
export function latestRevision(source: SourceOut) {
  if (!source.revisions || source.revisions.length === 0) return null;
  return source.revisions.reduce((latest, item) =>
    item.revision_no > latest.revision_no ? item : latest,
  );
}

/** 未关联的目标块（link === null）。契约：未关联就是未关联，不按文本猜。 */
export function unlinkedObjects(provenance: ResumeProvenanceOut | null): DocumentObjectOut[] {
  if (!provenance) return [];
  return provenance.objects.filter((item) => item.link === null);
}

/** stale 关联（来源已更新，块可能受影响）。 */
export function staleLinks(provenance: ResumeProvenanceOut | null): BlockLinkOut[] {
  if (!provenance) return [];
  return provenance.objects.flatMap((item) =>
    item.link && item.link.status === "stale" ? [item.link] : [],
  );
}

/** 覆盖率（未关联数按服务端给的 coverage 展示，不在前端重算 total-linked）。 */
export function coverageUnlinked(coverage: ProvenanceCoverage | null | undefined): number {
  if (!coverage) return 0;
  return Math.max(0, coverage.unlinked ?? Math.max(0, coverage.total - coverage.linked));
}

/**
 * 按当前选中对象过滤目标块：object_id 优先，其次 point_id，最后 path。
 * 都匹配不到返回空数组（界面显示"未建立来源关联"而不是猜一块）。
 */
export function objectsForSelection(
  provenance: ResumeProvenanceOut | null,
  selection: { object_id?: string | null; point_id?: string | null; path?: string | null },
): DocumentObjectOut[] {
  if (!provenance) return [];
  const objectId = selection.object_id ?? null;
  const pointId = selection.point_id ?? null;
  const path = selection.path ?? null;
  if (objectId) {
    return provenance.objects.filter((item) => item.object_id === objectId);
  }
  if (pointId) {
    return provenance.objects.filter((item) => item.point_id === pointId);
  }
  if (path) {
    return provenance.objects.filter((item) => item.path === path);
  }
  return [];
}

/** 候选初始状态（三条模式各自 idle）。 */
export function initialCandidateStates(modes: readonly CandidateMode[]): WritingCandidateState[] {
  return modes.map((mode) => ({ mode, status: "idle", suggestion: null, errorMessage: "" }));
}

/** 合并一条候选的终态（成功/失败/过期），返回新数组。 */
export function withCandidateState(
  states: readonly WritingCandidateState[],
  mode: CandidateMode,
  next: Partial<WritingCandidateState> & Pick<WritingCandidateState, "status">,
): WritingCandidateState[] {
  return states.map((item) => (item.mode === mode ? { ...item, ...next } : item));
}

/** 业务码 → 界面分流（只有两种冲突是用户可解释的）。 */
export function conflictKind(businessCode: string | undefined | null) {
  if (businessCode === "fact_lock_conflict") return "fact_lock" as const;
  if (businessCode === "resume_revision_conflict") return "revision" as const;
  return "other" as const;
}

/**
 * 把 409 的响应体形状收窄（`ApiError.payload` 保留了解析后的错误响应体原文，
 * 见 `api/apiError.ts` 的 payload 字段；事实锁 409 的 violations[] 只在这里能拿到）。
 */
export function asFactLockConflict(value: unknown): FactLockConflictOut | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.code !== "fact_lock_conflict" || !Array.isArray(record.violations)) return null;
  return value as FactLockConflictOut;
}

/**
 * 从抛出的错误里读逐条事实锁违规（`ApiError.payload.violations`）。
 *
 * 兼容三种情况，任何情况都不抛异常：payload 缺失（旧客户端/非 409）→ []；
 * payload 不是事实锁冲突形状 → []；形状正确 → 逐条返回。组件据此决定
 * "显示逐条违规"还是"回退通用说明"。
 */
export function factLockViolationsFromError(error: unknown): FactLockViolationOut[] {
  const payload = (error as { payload?: unknown } | null | undefined)?.payload;
  const conflict = asFactLockConflict(payload);
  return conflict ? conflict.violations : [];
}

/** 事实锁列表里"当前对象"相关的锁（object_id 优先，退回 path）。 */
export function locksForSelection(
  locks: readonly FactLockOut[],
  selection: { object_id?: string | null; path?: string | null },
): FactLockOut[] {
  const objectId = selection.object_id ?? null;
  if (objectId) return locks.filter((lock) => lock.object_id === objectId);
  const path = selection.path ?? null;
  if (path) return locks.filter((lock) => lock.path === path);
  return [];
}

/** token 数字：null → null（未知），交给界面显示"未知"；**绝不把未知当 0**。 */
export function tokenText(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return String(value);
}

/** 耗时：毫秒 → 人类可读（>=1000 用秒，保留一位小数）。 */
export function durationText(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(1) + " s";
}

/** 一个聚合桶是否存在未知 token（界面据此把总量标"未知"）。 */
export function hasUnknownTokens(bucket: UsageBucketOut): boolean {
  return bucket.unknown_token_calls > 0 || bucket.total_tokens === null;
}

/** 费用展示：未估算时返回 null（界面显示"不估算费用"），已估算才给数字。 */
export function costAmount(cost: UsageCostOut | null | undefined): number | null {
  if (!cost || !cost.estimated) return null;
  return typeof cost.amount === "number" ? cost.amount : null;
}
