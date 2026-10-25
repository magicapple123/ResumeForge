// SPDX-License-Identifier: Apache-2.0
/**
 * 导出前核对卡（W19 / D20）：目标岗位、简历标题、联系方式、版本、文档模式、隐藏条目数。
 *
 * 只读展示（只读核对不新开弹层）；版本已变/缺联系方式等以 `Alert` 逐条给"怎么办"，
 * 不把个人审美或"必须填"这类非硬性项当阻断。数据来自与导出同一份快照的摘要。
 */
import { Alert, Button } from "antd";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import { collectExportWarnings, type ExportCheckWarning } from "../../../features/resume-delivery";
import type { ExportCheckSource, ExportCheckSummary } from "../../../features/resume-delivery";

const WARNING_KEY: Record<ExportCheckWarning, MessageKey> = {
  "no-target": "delivery.check.warning.no-target",
  "no-contact": "delivery.check.warning.no-contact",
  "has-hidden": "delivery.check.warning.has-hidden",
  "revision-changed": "delivery.check.warning.revision-changed",
  "long-cv": "delivery.check.warning.long-cv",
};

export interface ExportCheckCardProps {
  summary: ExportCheckSummary;
  /**
   * 摘要来源：`server` = 服务端按导出同一快照算的 `export_summary`；
   * `local` = 后端尚未就绪时按同一份导出输入在本机核对。必须如实标注。
   */
  source?: ExportCheckSource;
  checking?: boolean;
  checkFailed?: boolean;
  onRefresh?: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="resume-delivery-check-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function ExportCheckCard({
  summary,
  source = "local",
  checking = false,
  checkFailed = false,
  onRefresh,
}: ExportCheckCardProps) {
  const warnings = collectExportWarnings(summary);
  const modeKey: MessageKey =
    summary.document_mode === "long_cv"
      ? "delivery.check.mode.long_cv"
      : "delivery.check.mode.resume";
  return (
    <section className="resume-delivery-check" aria-label={t("delivery.check.title")}>
      <div className="resume-delivery-section-head">
        <span className="resume-delivery-section-title">{t("delivery.check.title")}</span>
        {onRefresh ? (
          <Button size="small" type="text" loading={checking} onClick={onRefresh}>
            {t("delivery.check.refresh")}
          </Button>
        ) : null}
      </div>
      {warnings.map((warning) => (
        <Alert
          key={warning}
          type={warning === "revision-changed" ? "error" : "warning"}
          showIcon
          title={t(WARNING_KEY[warning])}
        />
      ))}
      {checkFailed ? <Alert type="warning" showIcon title={t("delivery.check.failed")} /> : null}
      <p className="resume-delivery-hint">
        {source === "server" ? t("delivery.check.source.server") : t("delivery.check.source.local")}
      </p>
      <dl className="resume-delivery-check-list">
        <Row label={t("delivery.check.target")}>
          {summary.target_company || summary.target_job_title
            ? `${summary.target_company}${summary.target_company && summary.target_job_title ? " · " : ""}${summary.target_job_title}`
            : t("delivery.check.targetEmpty")}
        </Row>
        <Row label={t("delivery.check.resumeTitle")}>{summary.resume_title || "—"}</Row>
        <Row label={t("delivery.check.contact")}>
          {summary.contact_present
            ? t("delivery.check.contactPresent")
            : t("delivery.check.contactMissing")}
        </Row>
        <Row label={t("delivery.check.revision")}>#{summary.revision}</Row>
        <Row label={t("delivery.check.documentMode")}>{t(modeKey)}</Row>
        <Row label={t("delivery.check.hidden")}>
          {summary.hidden_count > 0
            ? t("delivery.check.hiddenCount", { count: summary.hidden_count })
            : t("delivery.check.hiddenNone")}
        </Row>
      </dl>
    </section>
  );
}
