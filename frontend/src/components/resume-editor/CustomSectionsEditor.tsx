// SPDX-License-Identifier: Apache-2.0
/**
 * 自建大字段的编辑块（C2/R-79 + 第 8 项 + 需求 #2）：**独立栏目**，不塞进 summary 或任何系统分区。
 *
 * 数据形状与后端 `ResumeCustomSection` 一致：一个栏目 = 标题 + 若干条目，条目 = 主文本 +
 * 若干「标签：值」行。`key` / `entry_id` 用隐藏字段保留：一次保存不能把稳定身份抹掉。
 *
 * 需求 #2（2026-10-27）：新建/编辑简历时，自建板块与系统板块用**同一种录入格式**：
 * - 板块名来自资料方案（`editor_schema.section_name`），**只读展示**——不再出现「自建板块」
 *   泛称输入框与板块级删除按钮；方案里没有这个板块（旧简历 / 板块已被删）时退回正文里的
 *   标题，同样只读；
 * - 有字段定义 → 按定义渲染固定字段表单（第 8 项，绑定规则见 `customSectionAlignment.ts`），
 *   不再有「添加标签行」按钮；
 * - 没有字段定义（方案里 0 字段 / 旧快照）→ 与系统板块一致的最小兜底：仅一个「内容」字段；
 *   老简历里已有的「标签：值」行仍原样显示并可编辑/保存（不丢数据，只是不再提供新增入口）。
 *
 * F10：方案里定义的自建板块即使还没有任何条目，也要有录入入口（页签名就是板块名）。
 * 投影对空板块不产出 `custom_sections` 条目，所以这里按编辑器视图补齐这些板块的骨架，
 * 用户点「添加条目」时才把它写进表单值（不凭空往正文里塞空板块）。
 *
 * 2026-10-28：每条条目卡也有「从资料填入本条」（与其他板块同一交互）。自建条目的形状是
 * `{text, lines}`，只补空值：text 空才填，lines 按 label 合并（非空值不覆盖、缺失行追加）。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeCustomEntry, ResumeCustomLine, ResumeCustomSection } from "../../types";
import type { EditorSectionOut } from "../../features/profile-library/types";
import {
  customEntryFillKey,
  type ProfileFillItem,
} from "../../features/profile/profileFillOptions";
import CustomSectionFields from "./CustomSectionFields";
import { alignCustomEntry, emptyCustomEntryLines } from "./customSectionAlignment";
import { useEditorSchemaSections } from "./editorSchemaContext";
import ProfileFillBar from "./ProfileFillBar";
import { useProfileFill } from "./profileFillContext";
import { fillCustomEntryFromSource } from "./profileEntryFill";

const EMPTY_ENTRY = { entry_id: "", text: "", lines: [] };
const TEXT_MAX = 4000;
const LINE_VALUE_MAX = 2000;

/** 同一自建板块内每条条目的形状键（用于「当前条目 / 已在其他条目」判定）。 */
function entryFillKeys(entries: readonly ResumeCustomEntry[] | undefined): string[] {
  return (entries ?? []).map((entry) => customEntryFillKey(entry));
}

/** 一个还没有正文的自建板块：显示板块名 + 一个「添加条目」入口。 */
function EmptyCustomSection({
  section,
  onAdd,
}: {
  section: EditorSectionOut;
  onAdd: (section: EditorSectionOut) => void;
}) {
  useLocale();
  return (
    <div
      style={{
        border: "1px dashed var(--rf-border-subtle)",
        borderRadius: 8,
        padding: "12px 16px",
        background: "var(--rf-surface-alt)",
      }}
    >
      <Space style={{ display: "flex", marginBottom: 8 }} wrap>
        <Typography.Text strong>{section.section_name}</Typography.Text>
        <Typography.Text type="secondary">{t("editor.custom-sections.empty")}</Typography.Text>
      </Space>
      <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => onAdd(section)}>
        {t("editor.custom-sections.add-entry")}
      </Button>
    </div>
  );
}

/**
 * 没有字段定义时的兜底：与系统板块同一种「固定字段」录入——只有一个「内容」字段。
 *
 * 老简历里已有的「标签：值」行是历史数据，**原样显示并可编辑/保存**（删掉等于丢用户内容），
 * 但这里不再提供「添加标签行」入口：新写的内容只走「内容」字段，与系统板块口径一致。
 */
function LegacyEntryFields({ entryName }: { entryName: number }) {
  useLocale();
  return (
    <>
      <Form.Item
        name={[entryName, "text"]}
        label={t("editor.custom-sections.content")}
        style={{ marginBottom: 12 }}
      >
        <Input.TextArea rows={3} maxLength={TEXT_MAX} />
      </Form.Item>
      <Form.List name={[entryName, "lines"]}>
        {(lines, lineOps) => (
          <div style={{ display: "grid", gap: 6 }}>
            {lines.map((line) => (
              <Space key={line.key} align="start" wrap>
                <Form.Item
                  name={[line.name, "label"]}
                  label={t("editor.custom-sections.label")}
                  rules={[{ required: true }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input maxLength={64} />
                </Form.Item>
                <Form.Item
                  name={[line.name, "value"]}
                  label={t("editor.custom-sections.value")}
                  style={{ marginBottom: 0, minWidth: 260 }}
                >
                  <Input maxLength={LINE_VALUE_MAX} />
                </Form.Item>
                <Tooltip title={t("editor.custom-sections.remove-line")}>
                  <Button
                    type="text"
                    danger
                    aria-label={t("editor.custom-sections.remove-line")}
                    icon={<DeleteOutlined />}
                    onClick={() => lineOps.remove(line.name)}
                  />
                </Tooltip>
              </Space>
            ))}
          </div>
        )}
      </Form.List>
    </>
  );
}

/**
 * 有字段定义的一条条目：字段表单（定义之外的历史行由 `CustomSectionFields` 兜底）。
 *
 * **对齐没落盘之前先不渲染输入框**：`Form.Item` 一旦绑到还不存在的 `lines[j]`，
 * rc-field-form 会把这个下标登记成一个空对象——watched 值里就凭空多出一行 `{}`，
 * 下一次对齐又会把它当成「历史未知行」再补一行，越对齐越长（实测 2 行变 3 行）。
 * 所以这里先渲染空，等宿主的挂载对齐把值写进表单后再渲染字段（差一帧，用户看不见）。
 */
function SchemaEntryFields({
  definition,
  entryName,
  lines,
  onRemoveLine,
}: {
  definition: EditorSectionOut;
  entryName: number;
  lines: readonly ResumeCustomLine[] | undefined;
  onRemoveLine: (lineIndex: number) => void;
}) {
  useLocale();
  const alignment = alignCustomEntry(definition.fields, lines);
  return (
    <>
      {/* 定义里已经没有主文本字段时，条目仍可能带着老正文：隐藏保留，一次保存不吞掉它。 */}
      {alignment.textField ? null : (
        <Form.Item name={[entryName, "text"]} hidden>
          <Input />
        </Form.Item>
      )}
      <CustomSectionFields
        entryName={entryName}
        alignment={alignment}
        onRemoveLine={onRemoveLine}
      />
    </>
  );
}

export default function CustomSectionsEditor() {
  useLocale();
  const form = Form.useFormInstance();
  const watched = Form.useWatch("custom_sections", form) as ResumeCustomSection[] | undefined;
  // Form.useWatch 首帧恒为 undefined（订阅在 mount 后建立）。首帧直接读表单值，否则
  // "正文里已有该自建板块"时会先渲染一遍同名骨架、下一帧才消失（历史数据 key 为空时
  // 更会永久重复，点骨架「添加条目」还会追加第二条同 key 板块）。
  const sectionsValue =
    watched ?? (form.getFieldValue("custom_sections") as ResumeCustomSection[] | undefined);
  const schemaSections = useEditorSchemaSections();
  // 自建板块的编辑器视图：名字与字段定义都来自资料方案（冻结快照同源）。
  const customSchemas = schemaSections.filter((section) =>
    section.section_key.startsWith("custom:"),
  );
  const schemaByKey = new Map(
    customSchemas.map((section) => [section.section_key, section] as const),
  );
  const existingKeys = new Set((sectionsValue ?? []).map((section) => section.key));
  const missingSections = customSchemas.filter((section) => !existingKeys.has(section.section_key));
  // 自建板块的条目级候选按完整 section key（custom:<id>）分组；没提供 Provider 时为 null。
  const fill = useProfileFill();
  const customFillSources = fill?.sources.customSections;

  /** 有字段定义的自建板块：`section_key` → 定义（没有键 = 走「仅内容」兜底）。 */
  const definitions = new Map(
    customSchemas
      .filter((section) => section.fields.length > 0)
      .map((section) => [section.section_key, section] as const),
  );

  /**
   * 挂载时做两件数据对齐（都只在"第一次拿到方案视图"时跑一次）：
   *
   * 1. **标题归一成方案名**（需求 #2：板块名以方案为唯一来源）。旧简历正文里的标题若与
   *    冻结视图不一致，保存时会被改成方案名；一致时一个字都不写（见下面第 2 条）；
   * 2. **条目的 `lines` 对齐到字段定义**（补齐缺失字段、按定义顺序重排、历史未知行原样留后）。
   *    投影只把**有值**的字段写成标签行，剩下的字段没有位置可绑，不补齐就没有输入框可填
   *    （见 customSectionAlignment.ts）。
   *
   * 三点约束：
   * 1. 只跑一次（`aligned`），之后用户的编辑不会被它覆盖；
   * 2. 没有变化就**不写**（`changed`）——写表单值会让草稿通道记一笔，凭空多出一条
   *    "恢复草稿"提示；
   * 3. schema 还没到时先不跑（等下一轮），否则对齐会被空定义跳过而永久失效。
   */
  const aligned = useRef(false);
  useEffect(() => {
    if (aligned.current || customSchemas.length === 0) return;
    const current =
      (form.getFieldValue("custom_sections") as ResumeCustomSection[] | undefined) ?? [];
    let changed = false;
    const next = current.map((section) => {
      const schemaSection = schemaByKey.get(section.key);
      const definition = definitions.get(section.key);
      let sectionChanged = false;
      let renamed = section;
      if (schemaSection && section.title !== schemaSection.section_name) {
        renamed = { ...section, title: schemaSection.section_name };
        sectionChanged = true;
      }
      let entries = renamed.entries ?? [];
      if (definition) {
        entries = entries.map((entry) => {
          const alignment = alignCustomEntry(definition.fields, entry.lines);
          if (!alignment.changed) return entry;
          sectionChanged = true;
          return { ...entry, lines: alignment.alignedLines };
        });
      }
      if (!sectionChanged) return section;
      changed = true;
      return { ...renamed, entries };
    });
    if (changed) form.setFieldValue("custom_sections", next);
    aligned.current = true;
    // customSchemas / schemaByKey / definitions 每次渲染都是新引用，不能进依赖数组；
    // 这里只在"第一次拿到方案视图"时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, schemaSections]);

  /**
   * 把一条资料候选填进当前条目：只补空值、不复制 `entry_id`。
   *
   * 用 `getFieldValue` 现取（watched 可能落后一帧）；没有实际变化就不写表单——
   * 否则"填入"会在什么都没改的情况下把简历标脏。
   */
  const fillCustomEntry = (
    sectionIndex: number,
    entryIndex: number,
    item: ProfileFillItem,
  ): void => {
    const path = ["custom_sections", sectionIndex, "entries", entryIndex];
    const result = fillCustomEntryFromSource(
      form.getFieldValue(path) as ResumeCustomEntry | undefined,
      item.value as Partial<Pick<ResumeCustomEntry, "text" | "lines">> | null,
    );
    if (!result.changed) return;
    form.setFieldValue(path, result.entry);
    fill?.onFilled();
  };

  const addSectionEntry = (section: EditorSectionOut): void => {
    const current =
      (form.getFieldValue("custom_sections") as ResumeCustomSection[] | undefined) ?? [];
    form.setFieldValue("custom_sections", [
      ...current,
      {
        key: section.section_key,
        title: section.section_name,
        entries: [{ ...EMPTY_ENTRY, lines: emptyCustomEntryLines(section.fields) }],
      },
    ]);
  };

  return (
    <Form.List name="custom_sections">
      {(sections) => (
        <div style={{ display: "grid", gap: 16 }}>
          {sections.map((section) => {
            const current = sectionsValue?.[section.name];
            const key = current?.key ?? "";
            const definition = definitions.get(key);
            const schemaSection = schemaByKey.get(key);
            // 板块名以方案为唯一来源；方案里没有（旧简历 / 板块已删除）才退回正文里的标题。
            const title = schemaSection?.section_name || current?.title || "";
            // 条目级候选按完整 section key 取；同一板块内互相识别"当前条目 / 已在其他条目"。
            const fillItems = key ? (customFillSources?.[key] ?? []) : [];
            const fillKeys = entryFillKeys(current?.entries);
            return (
              <div
                key={section.key}
                style={{
                  border: "1px solid var(--rf-border-subtle)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  background: "var(--rf-surface-alt)",
                }}
              >
                <Form.Item name={[section.name, "key"]} hidden>
                  <Input />
                </Form.Item>
                {/* 标题只读展示：值仍注册在表单里，保存/草稿恢复都逐字往返。 */}
                <Form.Item name={[section.name, "title"]} hidden>
                  <Input />
                </Form.Item>
                <Typography.Text strong>{title}</Typography.Text>
                <Form.List name={[section.name, "entries"]}>
                  {(entries, entryOps) => (
                    <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
                      {entries.map((entry) => (
                        <div
                          key={entry.key}
                          style={{
                            border: "1px dashed var(--rf-border-subtle)",
                            borderRadius: 6,
                            padding: "10px 12px",
                          }}
                        >
                          <Form.Item name={[entry.name, "entry_id"]} hidden>
                            <Input />
                          </Form.Item>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 6,
                            }}
                          >
                            {/* 条目卡标题 = 当前顺序的序号（2026-10-28 用户反馈 #6）：与系统板块
                                「条目名来自字段」不同，自建板块不拿字段内容当名字，顺序即身份。 */}
                            <span data-custom-entry-index={entry.name + 1}>
                              <Typography.Text strong>{entry.name + 1}</Typography.Text>
                            </span>
                            <Tooltip title={t("editor.custom-sections.remove-entry")}>
                              <Button
                                type="text"
                                danger
                                aria-label={t("editor.custom-sections.remove-entry")}
                                icon={<DeleteOutlined />}
                                onClick={() => entryOps.remove(entry.name)}
                              />
                            </Tooltip>
                          </div>
                          {/* 与系统板块同一种交互：有候选时每条一个「从资料填入本条」。
                              候选只在当前板块内去重，跨板块各填各的互不影响。 */}
                          {fillItems.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <ProfileFillBar
                                label={title}
                                items={fillItems}
                                existingKeys={
                                  new Set(
                                    fillKeys.filter(
                                      (entryKey, position) => position !== entry.name && entryKey,
                                    ),
                                  )
                                }
                                currentKey={fillKeys[entry.name]}
                                onFill={(item) => fillCustomEntry(section.name, entry.name, item)}
                              />
                            </div>
                          )}
                          {definition ? (
                            <SchemaEntryFields
                              definition={definition}
                              entryName={entry.name}
                              lines={current?.entries?.[entry.name]?.lines}
                              onRemoveLine={(lineIndex) => {
                                // 用 getFieldValue 现取（watched 可能落后一帧）：删行后
                                // 定义字段的绑定下标会随 label 重新命中，见 customSectionAlignment.ts。
                                const path = [
                                  "custom_sections",
                                  section.name,
                                  "entries",
                                  entry.name,
                                  "lines",
                                ];
                                const lines = [
                                  ...((form.getFieldValue(path) as ResumeCustomLine[]) ?? []),
                                ];
                                lines.splice(lineIndex, 1);
                                form.setFieldValue(path, lines);
                              }}
                            />
                          ) : (
                            <LegacyEntryFields entryName={entry.name} />
                          )}
                        </div>
                      ))}
                      <Button
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() =>
                          entryOps.add({
                            ...EMPTY_ENTRY,
                            lines: definition ? emptyCustomEntryLines(definition.fields) : [],
                          })
                        }
                      >
                        {t("editor.custom-sections.add-entry")}
                      </Button>
                    </div>
                  )}
                </Form.List>
              </div>
            );
          })}
          {missingSections.map((section) => (
            <EmptyCustomSection
              key={section.section_key}
              section={section}
              onAdd={addSectionEntry}
            />
          ))}
        </div>
      )}
    </Form.List>
  );
}
