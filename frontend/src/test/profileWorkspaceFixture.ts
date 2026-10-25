// SPDX-License-Identifier: Apache-2.0
/**
 * F6 前端测试共用的资料库 fixtures（测试基建，不是生产代码）。
 *
 * 只构造 workspace 编辑 DTO 的最小形状；label/name 用 ASCII，避免测试文件出现中文
 * 断言（cjkRatchet 的逐文件口径），组件文案一律用 t() 取。
 */
import type {
  EntryOut,
  FieldOut,
  LimitsOut,
  SectionOut,
  WorkspaceOut,
} from "../features/profile-library/types";
import type { GroupBriefOut } from "../features/profile-groups/types";

export function makeField(
  sectionKey: string,
  key: string,
  label: string,
  extra: Partial<FieldOut> = {},
): FieldOut {
  return {
    field_id: sectionKey + "." + key,
    section_key: sectionKey,
    key,
    label,
    field_type: "single_line",
    order: 1,
    default_collapsed: false,
    enum_suggestions: [],
    is_builtin: true,
    private: false,
    llm_allowed: true,
    webform_allowed: true,
    hidden: false,
    collapsed_override: null,
    preference_revision: 0,
    revision: 0,
    ...extra,
  };
}

export function makeSection(
  key: string,
  name: string,
  form: "singleton" | "multi",
  fields: FieldOut[],
  extra: Partial<SectionOut> = {},
): SectionOut {
  return {
    key,
    name,
    form,
    is_builtin: true,
    carrier_field_id: null,
    material_only: false,
    provenance: [],
    fields,
    revision: 0,
    deleted_at: null,
    ...extra,
  };
}

const SYSTEM_SECTIONS: Array<[string, string, "singleton" | "multi"]> = [
  ["basic_info", "Basic Info", "singleton"],
  ["educations", "Education", "multi"],
  ["experiences", "Experience", "multi"],
  ["projects", "Projects", "multi"],
  ["skills", "Skills", "multi"],
  ["campus_experiences", "Campus", "multi"],
  ["awards", "Awards", "multi"],
  ["summary", "Summary", "singleton"],
  ["publications", "Publications", "multi"],
  ["research_projects", "Research Projects", "multi"],
  ["patents", "Patents", "multi"],
  ["credentials", "Credentials", "multi"],
  ["languages", "Languages", "multi"],
];

export function makeAllSections(): SectionOut[] {
  return SYSTEM_SECTIONS.map(([key, name, form], index) => {
    if (key === "basic_info") {
      return makeSection(key, name, form, [
        makeField(key, "name", "Name"),
        makeField(key, "gender", "Gender"),
        makeField(key, "photo", "Photo", { field_type: "photo" }),
      ]);
    }
    return makeSection(key, name, form, [makeField(key, "title", "Title", { order: 1 + index })]);
  });
}

export const LIMITS: LimitsOut = {
  max_entries_per_section: 200,
  max_custom_fields_per_section: 20,
  max_groups: 20,
  single_line_chars: 200,
  multi_line_chars: 2000,
};

export function makeGroup(
  groupId: string,
  name: string,
  extra: Partial<GroupBriefOut> = {},
): GroupBriefOut {
  const participatingKeys = extra.participating_keys ?? SYSTEM_SECTIONS.map(([key]) => key);
  return {
    group_id: groupId,
    name,
    is_default: false,
    revision: 1,
    participating_keys: participatingKeys,
    member_count: participatingKeys.length,
    ...extra,
  };
}

export function makeWorkspace(overrides: Partial<WorkspaceOut> = {}): WorkspaceOut {
  const sections = overrides.sections ?? makeAllSections();
  const defaultGroup = makeGroup("group-default", "Default", {
    is_default: true,
    participating_keys: sections.map((section) => section.key),
  });
  return {
    sections,
    section_order: sections.map((section) => section.key),
    current_group: defaultGroup,
    groups: [defaultGroup],
    entries: [],
    workspace_revision: 3,
    pending_notice: null,
    upgrade: { has_legacy_data: false, new_profile_has_entries: false },
    limits: LIMITS,
    ...overrides,
  };
}

export function makeEntry(
  sectionKey: string,
  entryId: string,
  values: Record<string, string>,
  sortOrder = 0,
): EntryOut {
  return {
    entry_id: entryId,
    section_key: sectionKey,
    sort_order: sortOrder,
    values,
    revision: 1,
  };
}
