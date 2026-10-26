// SPDX-License-Identifier: Apache-2.0
/**
 * W10 对比视图里的**格式能力说明**：直接消费 W11 的 `format_capabilities` 矩阵
 * （经 `POST /api/resumes/{id}/preflight` 的 `capabilities` 字段下发），
 * 复用 `features/resume-preflight/capabilities.ts` 的解析与词条映射。
 *
 * ## 为什么只列"不是 supported 的格子"
 *
 * 矩阵有 14 项能力 × 6 种格式，全量铺开会把"试用模板"变成"格式能力大表"。用户在这里
 * 的风险是"换了模板/导出格式后某个细节失效"，所以只列**至少一个格式不是 supported** 的
 * 那几行（如 PDF 的斜体近似、链接不可点击）。全支持时一句"均支持"。
 *
 * ## 不在这里写判定
 *
 * 哪个格式支不支持只来自矩阵；本组件不 import 任何 if/else 能力规则（lead 口径）。
 * 未知能力键原样显示机器码（ASCII），不编解释。
 */
import { Space, Typography } from "antd";
import { t } from "../../../i18n";
import {
  FORMAT_LABEL_KEY,
  LEVEL_LABEL_KEY,
  parseCapabilities,
} from "../../../features/resume-preflight/capabilities";
import { useLocale } from "../../../i18n/i18nContext";

/** 与"换模板"最相关的几项（键名是后端 CAPABILITY_KEYS 的字面量）。 */
const RELEVANT_CAPABILITIES = [
  "italic",
  "link_clickable",
  "manual_page_break",
  "keep_with_next",
  "entry_spacing",
  "body_color",
  "page_numbers",
] as const;

const COMPARED_FORMATS = ["html", "pdf", "docx"] as const;

interface Props {
  /** 后端 `PreflightOut.capabilities` 原样（`format:capability` → level 的扁平字典）。 */
  capabilities: Record<string, string>;
}

export default function TrialCapabilityStrip({ capabilities }: Props) {
  useLocale();
  const matrix = parseCapabilities(capabilities);
  const lines: string[] = [];
  for (const capability of RELEVANT_CAPABILITIES) {
    const cell = matrix.rows.find((row) => row.capability === capability);
    if (!cell) continue;
    for (const format of COMPARED_FORMATS) {
      const level = cell.levels[format] ?? "unknown";
      if (level === "supported") continue;
      const formatKey = FORMAT_LABEL_KEY[format];
      const formatLabel = formatKey ? t(formatKey) : format;
      const capabilityLabel = cell.labelKey ? t(cell.labelKey) : capability;
      lines.push(`${formatLabel} ${capabilityLabel} ${t(LEVEL_LABEL_KEY[level])}`);
    }
  }
  if (lines.length === 0) {
    return <Typography.Text type="secondary">{t("trial.capability.allSupported")}</Typography.Text>;
  }
  return (
    <section className="template-trial-capability" aria-label={t("trial.capability.title")}>
      <Space size={6} wrap>
        <Typography.Text strong>{t("trial.capability.title")}</Typography.Text>
        {lines.map((line) => (
          <Typography.Text key={line} type="secondary">
            {line}
          </Typography.Text>
        ))}
      </Space>
    </section>
  );
}
