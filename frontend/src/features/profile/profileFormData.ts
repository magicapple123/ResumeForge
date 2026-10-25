// SPDX-License-Identifier: Apache-2.0
/**
 * 资料页的表单值数据层（F6，从 useProfilePage 拆出以守住单文件 500 行预算）。
 *
 * 这里只放**纯函数**：服务端编辑 DTO ↔ 表单草稿的转换、刷新合并、以及「表单值 → 本轮
 * 保存变更集」。它们不依赖 React，也不发请求，因此可以脱离页面单独推理与测试。
 *
 * 关键口径（与页面一致，改动必须两边一起看）：
 * - 表单模型：sections[sectionKey] = 条目数组；entry_key 是服务端 entry_id，新建条目用
 *   new: 临时键（保存时整条提交，成功重取 workspace 后换成稳定 id）；
 * - 值快照可能来自旧数据/手填夹具（undefined、数字、null 都可能出现）：统一按字符串收口，
 *   判空按空串处理——直接 trim 会在保存时抛异常中断整条链路；
 * - collectEntryChanges：已有条目只提交变化的 field_id（带 expected_revision），新建条目整条提交。
 */
import { makeTempEntryKey } from "../profile-library/ProfileEntrySection";
import type {
  BulkEntryItem,
  ProfileEntryDraft,
  ProfileFormValues,
  SectionOut,
  WorkspaceOut,
} from "../profile-library/types";

/** 是否为尚未保存的新条目（new: 前缀的临时键）。 */
export function isTempEntryKey(entryKey: unknown): boolean {
  return typeof entryKey === "string" && entryKey.startsWith("new:");
}

/** 值快照可能来自旧数据/手填夹具（undefined、数字、null 都可能出现）：统一收口成字符串。 */
export function asFieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizedValues(values: Record<string, unknown> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  Object.entries(values ?? {}).forEach(([fieldId, value]) => {
    normalized[fieldId] = asFieldText(value);
  });
  return normalized;
}

/** 服务端条目 -> 表单草稿（单例分区始终保证有一行，方便直接录入）。 */
function draftsFromWorkspace(workspace: WorkspaceOut, section: SectionOut): ProfileEntryDraft[] {
  const entries = workspace.entries
    .filter((entry) => entry.section_key === section.key)
    .sort((left, right) => left.sort_order - right.sort_order);
  const drafts = entries.map((entry) => ({
    entry_key: entry.entry_id,
    values: normalizedValues(entry.values),
  }));
  if (section.form === "singleton" && drafts.length === 0) {
    return [{ entry_key: makeTempEntryKey(), values: {} }];
  }
  return drafts;
}

/** 整份 workspace -> 表单值（首屏 / 取消编辑时用）。 */
export function toFormValues(workspace: WorkspaceOut): ProfileFormValues {
  const sections: Record<string, ProfileEntryDraft[]> = {};
  workspace.sections.forEach((section) => {
    sections[section.key] = draftsFromWorkspace(workspace, section);
  });
  return { sections };
}

/** 刷新 workspace 时保留编辑中的表单值：按 entry_key 对齐，保留未保存的新条目与改动。 */
export function mergeFormValues(
  current: ProfileFormValues | undefined,
  workspace: WorkspaceOut,
): ProfileFormValues {
  const oldSections = current?.sections ?? {};
  const sections: Record<string, ProfileEntryDraft[]> = {};
  workspace.sections.forEach((section) => {
    const nextDrafts = draftsFromWorkspace(workspace, section);
    const oldDrafts = oldSections[section.key] ?? [];
    const oldByKey = new Map(oldDrafts.map((draft) => [draft.entry_key, draft]));
    const merged = nextDrafts.map((draft) => {
      const old = oldByKey.get(draft.entry_key);
      return old
        ? {
            entry_key: draft.entry_key,
            values: { ...draft.values, ...normalizedValues(old.values) },
          }
        : draft;
    });
    const temps = oldDrafts.filter(
      (draft) =>
        isTempEntryKey(draft.entry_key) &&
        !nextDrafts.some((item) => item.entry_key === draft.entry_key),
    );
    sections[section.key] = [...merged, ...temps];
  });
  return { sections };
}

/** 表单值 -> 本轮变更集：新建条目整条提交；已有条目只提交变化的 field_id。 */
export function collectEntryChanges(
  workspace: WorkspaceOut,
  values: ProfileFormValues,
): BulkEntryItem[] {
  const stored = new Map(workspace.entries.map((entry) => [entry.entry_id, entry]));
  const items: BulkEntryItem[] = [];
  Object.entries(values.sections ?? {}).forEach(([sectionKey, rawDrafts]) => {
    // antd validateFields 只回"注册过的字段"；若某个隐藏 entry_key 漏注册，数组项会缺键。
    // 这里按分区兜底：单例分区最多一条，缺 key 时用服务端唯一那条的 entry_id 对齐。
    const drafts = Array.isArray(rawDrafts)
      ? rawDrafts
          .filter((draft) => Boolean(draft && draft.values))
          .map((draft) => ({ ...draft, values: normalizedValues(draft.values) }))
      : [];
    const singletonEntry =
      workspace.sections.find((section) => section.key === sectionKey)?.form === "singleton"
        ? workspace.entries.find((entry) => entry.section_key === sectionKey)
        : undefined;
    drafts.forEach((draft) => {
      if (
        !isTempEntryKey(draft.entry_key) &&
        typeof draft.entry_key !== "string" &&
        singletonEntry
      ) {
        draft = { ...draft, entry_key: singletonEntry.entry_id };
      }
      if (isTempEntryKey(draft.entry_key)) {
        // F6 表单里未触碰的字段可能是 undefined（antd Form.List 的初始条目），
        // 判空必须按空串处理；直接 trim 会在保存时抛异常中断整条链路。
        const hasValue = Object.values(draft.values).some(
          (value) => String(value ?? "").trim() !== "",
        );
        if (hasValue) items.push({ section_key: sectionKey, values: { ...draft.values } });
        return;
      }
      const entry = stored.get(draft.entry_key);
      if (!entry) return;
      const changed: Record<string, string> = {};
      Object.entries(draft.values).forEach(([fieldId, value]) => {
        if (asFieldText(entry.values[fieldId]) !== value) changed[fieldId] = value;
      });
      if (Object.keys(changed).length > 0) {
        items.push({
          section_key: sectionKey,
          entry_id: entry.entry_id,
          values: changed,
          expected_revision: entry.revision,
        });
      }
    });
  });
  return items;
}
