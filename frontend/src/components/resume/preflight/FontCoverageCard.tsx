// SPDX-License-Identifier: Apache-2.0
/**
 * D08 字体覆盖卡：缺字列表、粗体可用性、替代字体说明。**只诊断，不改参数**。
 *
 * `font_coverage` 为 `null` / `checked=false` 时不得显示"通过"——那会把"没检查"
 * 伪装成"检查过且没问题"（契约 §4.7 + W11 后端规则）。
 */
import { Alert, Space, Tag, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { FontCoveragePayload } from "../../../features/resume-preflight/types";

interface Props {
  coverage: FontCoveragePayload | null | undefined;
}

/** 缺字列表：超过 60 个字符就截断（后端也可能 `truncated`），不把卡片撑爆。 */
const MAX_CHARS_SHOWN = 60;

function missingLine(chars: string[]): string {
  const text = chars.slice(0, MAX_CHARS_SHOWN).join(" ");
  return chars.length > MAX_CHARS_SHOWN ? text + "…" : text;
}

export default function FontCoverageCard({ coverage }: Props) {
  useLocale();
  if (!coverage || !coverage.checked) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={t("preflight.font.title")}
        description={
          coverage?.font === null || coverage?.font === ""
            ? t("preflight.font.noFont")
            : t("preflight.font.notChecked")
        }
      />
    );
  }

  const regular = coverage.missing.regular;
  const bold = coverage.missing.bold;
  const missingCount = regular.length + bold.length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 12px",
        marginBottom: 12,
        border: "1px solid var(--rf-border-subtle)",
        borderRadius: "var(--rf-radius-control)",
        background: "var(--rf-surface-alt)",
      }}
    >
      <Space size={8} wrap>
        <Typography.Text strong>{t("preflight.font.title")}</Typography.Text>
        {coverage.font ? <Tag>{coverage.font}</Tag> : null}
        <Tag color={missingCount > 0 ? "red" : "green"}>
          {t("preflight.font.missing", { count: missingCount })}
        </Tag>
        <Typography.Text
          type={coverage.bold_available ? "secondary" : "warning"}
          style={{ fontSize: 12 }}
        >
          {coverage.bold_available
            ? t("preflight.font.boldAvailable")
            : t("preflight.font.boldFallback")}
        </Typography.Text>
      </Space>
      {regular.length > 0 ? (
        <Typography.Text style={{ fontSize: 12 }}>
          {t("preflight.font.missingList", { chars: missingLine(regular) })}
        </Typography.Text>
      ) : null}
      {bold.length > 0 ? (
        <Typography.Text style={{ fontSize: 12 }}>
          {t("preflight.font.role.bold")} ·{" "}
          {t("preflight.font.missingList", { chars: missingLine(bold) })}
        </Typography.Text>
      ) : null}
      {coverage.truncated ? (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          {t("preflight.font.truncated")}
        </Typography.Text>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("preflight.font.hint")}
      </Typography.Text>
    </div>
  );
}
