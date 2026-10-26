// SPDX-License-Identifier: Apache-2.0
/**
 * 新建 / 从资料填充的**来源分区面板**（F4 §5.2）：完全由服务端投影的
 * `source_layout` 驱动（7/13 个分区），前端不硬编码 7 个。
 *
 * 三条硬约束：
 * - **只读当前组**：不提供选组器（R-27），只给「去切换组」跳到资料页；
 * - **只做加法**：按分区「追加」只把还没出现过的条目补到末尾，不改已有正文（R-34）；
 * - **不重拼承载区/语言映射**：条目直接取自主影 content（服务端已拼好「标签：值」），
 *   语言分区只提示"按规则写入技能"（R-72 已在服务端完成）。
 *
 * 组件必须渲染在编辑器的 `<Form>` 内部（它要写表单值），但自身不注册任何 Form.Item；
 * 因此不会把新增字段带进 onFinish 的提交值。
 */
import { Button, Collapse, Form, Tag, Typography } from "antd";
import type { PaperProjectionOut } from "../../features/profile-library/types";
import {
  PROFILE_FILL_KEYS,
  projectionSectionFill,
} from "../../features/profile/profileFillOptions";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeContent } from "../../types";
import { useProfileFill } from "./profileFillContext";

interface Props {
  projection: PaperProjectionOut;
  /** 「去切换组」：跳到资料页；不传则不渲染该入口。 */
  onSwitchGroup?: () => void;
}

/** 基本信息里可以从投影带入的身份标量（照片走同一口径：只在空位填）。 */
const BASIC_FIELDS = [
  "photo",
  "name",
  "gender",
  "birth_year",
  "phone",
  "email",
  "city",
  "personal_website",
  "github",
] as const;

function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 追加到表单数组时复制一份：候选对象属于投影缓存，表单后续改动不能污染缓存。 */
function copyEntry(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export default function ProfileSourceTabs({ projection, onSwitchGroup }: Props) {
  useLocale();
  const form = Form.useFormInstance<ResumeContent>();
  const fill = useProfileFill();
  const rows = Array.isArray(projection?.source_layout) ? projection.source_layout : [];
  const content = projection?.content;

  const markFilled = (): void => fill?.onFilled();

  const appendSection = (sectionKey: string): void => {
    const sectionFill = projectionSectionFill(projection, sectionKey);
    if (!sectionFill) return;
    const current = (form.getFieldValue(sectionFill.contentField) as unknown[] | undefined) ?? [];
    const keyOf = PROFILE_FILL_KEYS[sectionFill.section];
    const existing = new Set(current.map((item) => keyOf(item)));
    const additions = sectionFill.items
      .filter((item) => !existing.has(item.matchKey ?? item.key))
      .map((item) => copyEntry(item.value));
    if (additions.length === 0) return;
    form.setFieldValue(sectionFill.contentField, [...current, ...additions]);
    markFilled();
  };

  /** 该分区还有没有"没加入"的候选：决定「追加本分区」是可用还是「已全部加入」。 */
  const pendingCount = (sectionKey: string): number => {
    const sectionFill = projectionSectionFill(projection, sectionKey);
    if (!sectionFill) return 0;
    const current = (form.getFieldValue(sectionFill.contentField) as unknown[] | undefined) ?? [];
    const keyOf = PROFILE_FILL_KEYS[sectionFill.section];
    const existing = new Set(current.map((item) => keyOf(item)));
    return sectionFill.items.filter((item) => !existing.has(item.matchKey ?? item.key)).length;
  };

  const fillBasic = (): void => {
    if (!content) return;
    for (const field of BASIC_FIELDS) {
      const value = content[field];
      if (!isBlankValue(form.getFieldValue(field)) || isBlankValue(value)) continue;
      form.setFieldValue(field, value);
    }
    markFilled();
  };

  const fillSummary = (): void => {
    if (!content) return;
    if (!isBlankValue(form.getFieldValue("summary")) || isBlankValue(content.summary)) return;
    form.setFieldValue("summary", content.summary);
    markFilled();
  };

  const renderRow = (row: PaperProjectionOut["source_layout"][number]) => {
    const isBasic = row.section_key === "basic_info";
    const isSummary = row.section_key === "summary";
    const isLanguages = row.section_key === "languages";
    const isCustom = row.section_key.startsWith("custom:");
    const isAppendable = projectionSectionFill(projection, row.section_key) !== null;
    const pending = isAppendable ? pendingCount(row.section_key) : 0;
    return (
      <div
        key={row.section_key}
        className="resume-source-row"
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <Typography.Text strong>{row.section_name}</Typography.Text>
        <Tag>
          {row.form === "singleton"
            ? t("editor.sources.singleton")
            : t("editor.sources.entry-count", { count: row.entry_count })}
        </Tag>
        {row.material_only && <Tag>{t("editor.sources.material-only")}</Tag>}
        {isCustom && <Tag>{t("editor.sources.custom")}</Tag>}
        <span style={{ marginLeft: "auto" }} />
        {isBasic && (
          <Button size="small" onClick={fillBasic}>
            {t("editor.sources.fill-basic")}
          </Button>
        )}
        {isSummary && (
          <Button size="small" onClick={fillSummary}>
            {t("editor.sources.fill-summary")}
          </Button>
        )}
        {isAppendable &&
          (pending > 0 ? (
            <Button size="small" onClick={() => appendSection(row.section_key)}>
              {t("editor.sources.append")}
            </Button>
          ) : (
            <Button size="small" disabled>
              {t("editor.sources.appended")}
            </Button>
          ))}
        {isLanguages && (
          <Typography.Text type="secondary">{t("editor.sources.languages-hint")}</Typography.Text>
        )}
        {isCustom && (
          <Typography.Text type="secondary">{t("editor.sources.custom-hint")}</Typography.Text>
        )}
      </div>
    );
  };

  return (
    <Collapse
      size="small"
      className="resume-source-panel"
      style={{ marginBottom: 12 }}
      items={[
        {
          key: "sources",
          label: (
            <span>
              <Typography.Text strong>{t("editor.sources.title")}</Typography.Text>
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {t("editor.sources.hint")}
              </Typography.Text>
            </span>
          ),
          children: (
            <div style={{ display: "grid", gap: 8 }}>
              {rows.length === 0 ? (
                <Typography.Text type="secondary">{t("editor.sources.empty")}</Typography.Text>
              ) : (
                rows.map((row) => renderRow(row))
              )}
              {onSwitchGroup && (
                <Button
                  type="link"
                  size="small"
                  style={{ justifySelf: "start", padding: 0 }}
                  onClick={onSwitchGroup}
                >
                  {t("editor.sources.switch")}
                </Button>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
