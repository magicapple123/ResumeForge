// SPDX-License-Identifier: Apache-2.0
/**
 * 检查清单里的一条问题（W11 / P0-04）：严重度、说明、定位、影响、证据、真实修复入口。
 *
 * "真实修复入口"的判定：`fix` 存在 + 宿主给了 `onFix` + 该动作在宿主声明的可用集合里。
 * 三者缺一就不渲染按钮（宁可不摆，也不摆一颗点了没反应的按钮）；此时给一句
 * "没有自动修复入口，请手动处理"，把去路说清。
 */
import { Button, Tag, Typography } from "antd";
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  fixLabelKey,
  issueTitleKey,
  locatorSummary,
} from "../../../features/resume-preflight/model";
import type {
  CheckFix,
  CheckFixAction,
  CheckIssue,
  CheckSeverity,
} from "../../../features/resume-preflight/types";

const SEVERITY_LABEL_KEY: Record<CheckSeverity, MessageKey> = {
  blocker: "preflight.severity.blocker",
  verify: "preflight.severity.verify",
  suggestion: "preflight.severity.suggestion",
};

const SEVERITY_COLOR: Record<CheckSeverity, string> = {
  blocker: "red",
  verify: "orange",
  suggestion: "blue",
};

/**
 * The title key is stable protocol identity. Unknown keys use detail's first sentence;
 * display text never controls whether detail is shown.
 */
function issueTitle(issue: CheckIssue): string {
  const titleKey = issueTitleKey(issue.code);
  if (titleKey) return t(titleKey);
  // 未知机器码：退回已本地化的 detail 首句；都没有才用兜底标题（不显示 code 当文案）。
  const detail = issue.detail.trim();
  if (detail) {
    // 中文句号/分号用 Unicode 转义写：源码保持 ASCII，界面行为不变。
    const firstSentence = detail.split(/[\u3002\uff1b\n]/)[0]?.trim();
    if (firstSentence) return firstSentence;
  }
  return t("preflight.issue.untitled");
}

interface Props {
  issue: CheckIssue;
  /** 宿主分派修复动作；不传 = 不渲染任何修复按钮。 */
  onFix?: (fix: CheckFix) => void;
  /** 宿主声明"这次真的能处理"的动作；undefined = 不限制（兼容旧宿主）。 */
  availableFixActions?: ReadonlySet<CheckFixAction>;
}

export default function CheckIssueRow({ issue, onFix, availableFixActions }: Props) {
  useLocale();
  const stableTitleKey = issueTitleKey(issue.code);
  const title = issueTitle(issue);
  const location = locatorSummary(issue);
  const fix = issue.fix;
  const fixAvailable = Boolean(
    fix && onFix && (!availableFixActions || availableFixActions.has(fix.action)),
  );
  const rawDetail = issue.detail.trim();
  const fallbackTitle = stableTitleKey ? "" : rawDetail.split(/[\u3002\uff1b\n]/)[0]?.trim();
  const detailLines =
    rawDetail && (stableTitleKey !== null || rawDetail !== fallbackTitle) ? issue.detail : "";
  return (
    <li
      style={{
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 0",
        borderBottom: "1px solid var(--rf-border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag color={SEVERITY_COLOR[issue.severity]} style={{ marginInlineEnd: 0 }}>
          {t(SEVERITY_LABEL_KEY[issue.severity])}
        </Tag>
        <Typography.Text strong>{title}</Typography.Text>
        {location ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("preflight.issue.locationLine", {
              label: t("preflight.issue.location"),
              value: location,
            })}
          </Typography.Text>
        ) : null}
      </div>
      {detailLines ? <Typography.Text>{detailLines}</Typography.Text> : null}
      {issue.impact.trim() ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("preflight.issue.impactLine", {
            label: t("preflight.issue.impact"),
            value: issue.impact,
          })}
        </Typography.Text>
      ) : null}
      {issue.evidence.length > 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("preflight.issue.evidenceLine", {
            label: t("preflight.issue.evidence"),
            value: issue.evidence.join(" · "),
          })}
        </Typography.Text>
      ) : null}
      {fixAvailable && fix ? (
        <div>
          <Button size="small" onClick={() => onFix?.(fix)}>
            {t(fixLabelKey(fix))}
          </Button>
        </div>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("preflight.issue.noFix")}
        </Typography.Text>
      )}
    </li>
  );
}
