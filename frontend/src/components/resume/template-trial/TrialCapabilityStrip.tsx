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
 * ## 一行一项能力，格式放在值里
 *
 * 原先按"格式 → 能力"平铺成一串（`精确 PDF 斜体 近似 精确 PDF 链接可点击 不支持 …`）：
 * 同一个格式前缀反复出现、相邻两项之间没有分隔，读起来是一行没有结构的字（2026-10-29
 * 用户反馈"看着有点乱"）。现在一项能力一行，行内只留**不是 supported** 的格式，
 * 值写成"格式 + 等级"的短标签，视线可以按"哪个能力 / 哪些导出会打折"两列扫。
 *
 * ## 不在这里写判定
 *
 * 哪个格式支不支持只来自矩阵；本组件不 import 任何 if/else 能力规则（lead 口径）。
 * 未知能力键原样显示机器码（ASCII），不编解释。
 */
import { Fragment } from "react";
import { Tag, Typography } from "antd";
import { t } from "../../../i18n";
import {
  FORMAT_LABEL_KEY,
  LEVEL_LABEL_KEY,
  parseCapabilities,
  type CapabilityLevel,
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

interface CapabilityCell {
  format: string;
  level: CapabilityLevel;
  /** 已经是"格式 + 等级"的完整标签（如 `精确 PDF 不支持`）。 */
  text: string;
}

interface CapabilityRow {
  capability: string;
  label: string;
  cells: CapabilityCell[];
}

interface Props {
  /** 后端 `PreflightOut.capabilities` 原样（`format:capability` → level 的扁平字典）。 */
  capabilities: Record<string, string>;
}

/** 按"一项能力一行"装箱：行内只留不是 supported 的格式（顺序固定 html → pdf → docx）。 */
function buildRows(capabilities: Record<string, string>): CapabilityRow[] {
  const matrix = parseCapabilities(capabilities);
  const rows: CapabilityRow[] = [];
  for (const capability of RELEVANT_CAPABILITIES) {
    const cell = matrix.rows.find((row) => row.capability === capability);
    if (!cell) continue;
    const cells: CapabilityCell[] = [];
    for (const format of COMPARED_FORMATS) {
      const level = cell.levels[format] ?? "unknown";
      if (level === "supported") continue;
      const formatKey = FORMAT_LABEL_KEY[format];
      cells.push({
        format,
        level,
        text: `${formatKey ? t(formatKey) : format} ${t(LEVEL_LABEL_KEY[level])}`,
      });
    }
    if (cells.length === 0) continue;
    rows.push({
      capability,
      label: cell.labelKey ? t(cell.labelKey) : capability,
      cells,
    });
  }
  return rows;
}

export default function TrialCapabilityStrip({ capabilities }: Props) {
  useLocale();
  const rows = buildRows(capabilities);
  if (rows.length === 0) {
    return <Typography.Text type="secondary">{t("trial.capability.allSupported")}</Typography.Text>;
  }
  return (
    <section className="template-trial-capability" aria-label={t("trial.capability.title")}>
      <div className="template-trial-capability-head">
        <Typography.Text strong>{t("trial.capability.title")}</Typography.Text>
        <Typography.Text type="secondary" className="template-trial-capability-hint">
          {t("trial.capability.hint")}
        </Typography.Text>
      </div>
      {/* dl/dt/dd：名称一列按最长的能力名对齐，值一列放该能力的格式标签。 */}
      <dl className="template-trial-capability-list">
        {rows.map((row) => (
          <Fragment key={row.capability}>
            <dt>
              <Typography.Text type="secondary">{row.label}</Typography.Text>
            </dt>
            <dd>
              {row.cells.map((cell) => (
                // 不按等级配色：整片是"差异说明"，不是报错；等级由文字本身区分
                // （一张金黄一张灰反而把"支持程度"读成了严重性）。
                <Tag key={cell.format} className="template-trial-capability-tag">
                  {cell.text}
                </Tag>
              ))}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
