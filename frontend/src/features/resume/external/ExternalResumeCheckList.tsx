// SPDX-License-Identifier: Apache-2.0
/**
 * 详情弹层「文本检查」的全部呈现（从 `ExternalResumeDetailDrawer` 里拆出来，T12）。
 *
 * 为什么拆：抽屉本身已经 400+ 行（Modal 骨架 + 五个页签 + 记录缓存 + 版本视图），
 * 而检查结果这一段是**纯展示**——六类结论各自的判定、标签颜色、句子里塞哪几个数。
 * 两件事混在一个文件里，既超 500 行预算，也让人读抽屉时要跳过一百多行"占比怎么算"。
 *
 * 口径照旧：**没有总分**，每类各给一条结论 + 命中片段的行号；未提取到文字时由调用方
 * 直接说明（这个文件不出现"检查通过"这种话）。
 */
import { Alert, Space, Tag, Typography } from "antd";
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { AnalysisCheck, ExternalResumeAnalysis } from "../../../api/externalResumes";

type CheckStatus = "ok" | "warn" | "info";

/** 每类检查的"正常 / 需注意"判定（文案 key 也是界面语汇，协议 key 来自后端）。 */
const CHECK_META: Record<
  string,
  { label: MessageKey; status: (check: AnalysisCheck) => CheckStatus }
> = {
  placeholder: {
    label: "resumesPage.external.checkPlaceholder",
    status: (check) => (check.count > 0 ? "warn" : "ok"),
  },
  quantification: {
    label: "resumesPage.external.checkQuantification",
    // 样本太少时不下结论（3 条以下量化描述可能是巧合），避免把刚写的简历判成"没量化"。
    status: (check) => (check.sample_size >= 3 && (check.ratio ?? 0) < 0.3 ? "warn" : "ok"),
  },
  contact: {
    label: "resumesPage.external.checkContact",
    status: (check) => (check.count > 0 ? "ok" : "warn"),
  },
  length: {
    label: "resumesPage.external.checkLength",
    status: () => "info",
  },
  weak_wording: {
    label: "resumesPage.external.checkWeakWording",
    status: (check) => (check.count > 0 ? "warn" : "ok"),
  },
  keywords: {
    label: "resumesPage.external.checkKeywords",
    status: (check) => ((check.ratio ?? 0) < 0.6 ? "warn" : "ok"),
  },
};

function percent(ratio: number | null): number {
  return Math.round((ratio ?? 0) * 100);
}

function statusTag(status: CheckStatus) {
  if (status === "ok") {
    return <Tag color="success">{t("resumesPage.external.checkStatusOk")}</Tag>;
  }
  if (status === "warn") {
    return <Tag color="warning">{t("resumesPage.external.checkStatusWarn")}</Tag>;
  }
  return <Tag>{t("resumesPage.external.checkStatusInfo")}</Tag>;
}

/** 每类检查的一句结论（比例一律换算成百分比，避免界面出现 0.4 这种原始小数）。 */
export function checkDetail(check: AnalysisCheck): string {
  switch (check.key) {
    case "placeholder":
      return check.count > 0
        ? t("resumesPage.external.checkPlaceholderDetail", { count: check.count })
        : t("resumesPage.external.checkPlaceholderOk");
    case "quantification":
      return t("resumesPage.external.checkQuantificationDetail", {
        count: check.count,
        total: check.sample_size,
        ratio: percent(check.ratio),
      });
    case "contact":
      return check.count > 0
        ? t("resumesPage.external.checkContactDetail", { count: check.count })
        : t("resumesPage.external.checkContactMissing");
    case "length":
      return t("resumesPage.external.checkLengthDetail", {
        chars: check.count,
        lines: check.sample_size,
        pages: Math.max(0.1, Math.round((check.count / 1200) * 10) / 10),
      });
    case "weak_wording":
      return check.count > 0
        ? t("resumesPage.external.checkWeakWordingDetail", {
            count: check.count,
            total: check.sample_size,
            ratio: percent(check.ratio),
          })
        : t("resumesPage.external.checkWeakWordingOk");
    case "keywords": {
      const keywords = check.keywords;
      if (!keywords) return "";
      const base = t("resumesPage.external.checkKeywordsDetail", {
        matched: keywords.matched.length,
        target: keywords.target.length,
        ratio: percent(keywords.coverage_ratio),
      });
      return keywords.missing.length > 0
        ? `${base} · ${t("resumesPage.external.checkKeywordsMissing", {
            words: keywords.missing.join(" / "),
          })}`
        : base;
    }
    default:
      return "";
  }
}

export interface ExternalResumeCheckListProps {
  analysis: ExternalResumeAnalysis;
}

/** 检查结果列表：一句总述 + 每类一段（标题 + 标签 + 结论 + 命中行）。 */
export function ExternalResumeCheckList({ analysis }: ExternalResumeCheckListProps) {
  useLocale();
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }} data-testid="external-check-list">
      <Alert type="info" showIcon title={t("resumesPage.external.checkHint")} />
      {analysis.checks.map((check) => {
        const meta = CHECK_META[check.key];
        if (!meta) return null;
        return (
          <div key={check.key} data-testid={`external-check-${check.key}`}>
            <Space size={8} wrap>
              <Typography.Text strong>{t(meta.label)}</Typography.Text>
              {statusTag(meta.status(check))}
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {checkDetail(check)}
            </Typography.Paragraph>
            {check.items.length > 0 ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {check.items.map((item) => (
                  <li key={`${check.key}-${item.line}-${item.text.slice(0, 12)}`}>
                    <Typography.Text type="secondary">
                      {t("resumesPage.external.lineWithText", {
                        line: item.line,
                        text: item.text,
                      })}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </Space>
  );
}

export default ExternalResumeCheckList;
