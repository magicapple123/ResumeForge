// SPDX-License-Identifier: Apache-2.0
/**
 * 自建大字段的编辑块（C2/R-79 + 第 8 项）：**独立栏目**，不塞进 summary 或任何系统分区。
 *
 * 数据形状与后端 `ResumeCustomSection` 一致：一个栏目 = 标题 + 若干条目，条目 = 主文本 +
 * 若干「标签：值」行。`key` / `entry_id` 用隐藏字段保留：一次保存不能把稳定身份抹掉。
 *
 * 第 8 项（2026-10-27）：自建板块**有字段定义时**按定义渲染，与系统板块同一个录入方式
 * （字段 label 当标签、单行两列、多行整行），字段绑定规则见 `customSectionAlignment.ts`。
 * 没有定义时（旧快照 / 板块已被删）保持原来的通用编辑器，行为逐字不变。
 *
 * F10：方案里定义的自建板块即使还没有任何条目，也要有录入入口（页签名就是板块名）。
 * 投影对空板块不产出 `custom_sections` 条目，所以这里按编辑器视图补齐这些板块的骨架，
 * 用户点「添加条目」时才把它写进表单值（不凭空往正文里塞空板块）。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeCustomLine, ResumeCustomSection } from "../../types";
import type { EditorSectionOut } from "../../features/profile-library/types";
import CustomSectionFields from "./CustomSectionFields";
import { alignCustomEntry, emptyCustomEntryLines } from "./customSectionAlignment";
import { useEditorSchemaSections } from "./editorSchemaContext";

const EMPTY_LINE = { label: "", value: "" };
const EMPTY_ENTRY = { entry_id: "", text: "", lines: [] };

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

/** 一条条目的「标签 + 值 + 删除」通用行（无字段定义时，或定义之外的历史行）。 */ function LegacyLines({
  entryName,
}: {
  entryName: number;
}) {
  useLocale();
  return (
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
                <Input maxLength={2000} />
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
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => lineOps.add({ ...EMPTY_LINE })}
          >
            {t("editor.custom-sections.add-line")}
          </Button>
        </div>
      )}
    </Form.List>
  );
}

/**
 * 有字段定义的一条条目：字段表单 + 「添加一行」（定义之外的自定义行）。
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
      <CustomSectionFields
        entryName={entryName}
        alignment={alignment}
        onRemoveLine={onRemoveLine}
      />
      <Form.List name={[entryName, "lines"]}>
        {(_fields, lineOps) => (
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => lineOps.add({ ...EMPTY_LINE })}
          >
            {t("editor.custom-sections.add-line")}
          </Button>
        )}
      </Form.List>
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
  const existingKeys = new Set((sectionsValue ?? []).map((section) => section.key));
  const missingSections = schemaSections.filter(
    (section) =>
      section.section_key.startsWith("custom:") && !existingKeys.has(section.section_key),
  );

  /** 有字段定义的自建板块：`section_key` → 定义（没有键 = 走通用编辑器兜底）。 */
  const definitions = new Map(
    schemaSections
      .filter((section) => section.section_key.startsWith("custom:") && section.fields.length > 0)
      .map((section) => [section.section_key, section] as const),
  );

  /**
   * 挂载时把已有条目的 `lines` 对齐到字段定义（补齐缺失字段、按定义顺序重排、
   * 历史未知行原样留后）。为什么要在这里写一次表单值：投影只把**有值**的字段写成
   * 标签行，剩下的字段没有位置可绑，不补齐就没有输入框可填（见 customSectionAlignment.ts）。
   *
   * 三点约束：
   * 1. 只跑一次（`aligned`），之后用户的编辑不会被它覆盖；
   * 2. 没有变化就**不写**（`changed`）——写表单值会让草稿通道记一笔，凭空多出一条
   *    "恢复草稿"提示；
   * 3. schema 还没到时先不跑（等下一轮），否则对齐会被空定义跳过而永久失效。
   */
  const aligned = useRef(false);
  useEffect(() => {
    if (aligned.current || definitions.size === 0) return;
    const current =
      (form.getFieldValue("custom_sections") as ResumeCustomSection[] | undefined) ?? [];
    let changed = false;
    const next = current.map((section) => {
      const definition = definitions.get(section.key);
      if (!definition) return section;
      let sectionChanged = false;
      const entries = (section.entries ?? []).map((entry) => {
        const alignment = alignCustomEntry(definition.fields, entry.lines);
        if (!alignment.changed) return entry;
        sectionChanged = true;
        return { ...entry, lines: alignment.alignedLines };
      });
      if (!sectionChanged) return section;
      changed = true;
      return { ...section, entries };
    });
    if (changed) form.setFieldValue("custom_sections", next);
    aligned.current = true;
    // definitions 每次渲染都是新 Map，不能进依赖数组；这里只在"第一次拿到定义"时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, schemaSections]);

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
      {(sections, sectionOps) => (
        <div style={{ display: "grid", gap: 16 }}>
          {sections.map((section) => {
            const definition = definitions.get(sectionsValue?.[section.name]?.key ?? "");
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
                <Space style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item
                    name={[section.name, "title"]}
                    label={t("editor.tab.custom-sections")}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 0, minWidth: 260 }}
                  >
                    <Input maxLength={40} />
                  </Form.Item>
                  <Tooltip title={t("editor.custom-sections.remove-section")}>
                    <Button
                      type="text"
                      danger
                      aria-label={t("editor.custom-sections.remove-section")}
                      icon={<DeleteOutlined />}
                      onClick={() => sectionOps.remove(section.name)}
                    />
                  </Tooltip>
                </Space>
                <Form.List name={[section.name, "entries"]}>
                  {(entries, entryOps) => (
                    <div style={{ display: "grid", gap: 12 }}>
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
                              justifyContent: "flex-end",
                              marginBottom: 6,
                            }}
                          >
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
                          {definition ? (
                            <SchemaEntryFields
                              definition={definition}
                              entryName={entry.name}
                              lines={sectionsValue?.[section.name]?.entries?.[entry.name]?.lines}
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
                            <>
                              <Form.Item
                                name={[entry.name, "text"]}
                                label={t("editor.custom-sections.text")}
                                style={{ marginBottom: 12 }}
                              >
                                <Input.TextArea rows={3} maxLength={4000} />
                              </Form.Item>
                              <LegacyLines entryName={entry.name} />
                            </>
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
