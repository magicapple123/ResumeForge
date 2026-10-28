// SPDX-License-Identifier: Apache-2.0
/**
 * 新建简历的**来源分区面板**（F4 §5.2）：完全由服务端投影的 `source_layout` 驱动，
 * 前端不硬编码分区数。
 *
 * 三条硬约束：
 * - **只读当前组**：不提供选组器（R-27），只给「去切换组」跳到资料页；
 * - **只给单条入口**：基本信息/个人总结可以整块带入（它们没有"第几条"）；
 *   多条目板块（教育/科研/证照…）的「从资料填入本条」在各条目卡片上，
 *   板块级的「追加本分区」已按用户反馈（任务 #9）下线；
 * - **不重拼承载区/语言映射**：值直接取自主影 content（服务端已拼好「标签：值」）。
 *
 * 组件必须渲染在编辑器的 `<Form>` 内部（它要写表单值），但自身不注册任何 Form.Item；
 * 因此不会把新增字段带进 onFinish 的提交值。
 */
import { Button, Collapse, Form, Tag, Typography } from "antd";
import type { PaperProjectionOut } from "../../features/profile-library/types";
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

export default function ProfileSourceTabs({ projection, onSwitchGroup }: Props) {
  useLocale();
  const form = Form.useFormInstance<ResumeContent>();
  const fill = useProfileFill();
  const rows = Array.isArray(projection?.source_layout) ? projection.source_layout : [];
  const content = projection?.content;

  const markFilled = (): void => fill?.onFilled();

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
