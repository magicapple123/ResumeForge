// SPDX-License-Identifier: Apache-2.0
/**
 * W10 对比视图的一栏：模板选择 + 真实渲染预览 + 实际页数/溢出 + 能力与已知差异 + 采纳。
 *
 * 一栏只负责"展示与动作"，取数在 `useTemplateTrial`；两侧共用本组件，避免左右各写一份。
 * 页数措辞与精确预览/制作台同一套；示例模式**不显示页数**（见 `measure` 分支）。
 */
import { Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import LoadingBlock from "../../common/LoadingBlock";
import A4PreviewFrame from "../../templates/A4PreviewFrame";
import { t } from "../../../i18n";
import type { ResumeTemplateOption } from "../../../types";
import type {
  TrialMeasurement,
  TrialSideState,
} from "../../../features/resume-template-trial/types";
import type { TemplateCapability } from "../../../features/resume-template-trial/templateProfile";
import { withHiddenScrollbar } from "../../../utils/iframeDocument";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  /** 侧名（左侧/右侧）。 */
  sideLabel: string;
  state: TrialSideState;
  templates: ResumeTemplateOption[];
  currentTemplate: string;
  capability: TemplateCapability;
  mode: "demo" | "current";
  measureEnabled: boolean;
  pageLimit: number;
  hasResumeContent: boolean;
  onTemplateChange: (template: string) => void;
  onRetry: () => void;
  onAdopt: () => void;
}

function measurementText(measurement: TrialMeasurement): string {
  const limit = measurement.pageLimit ?? measurement.pages;
  if (measurement.pagesNeeded !== null && limit !== null) {
    return t("trial.measure.pages", { pages: measurement.pagesNeeded, limit });
  }
  if (measurement.pages !== null) {
    return t("trial.measure.pagesPlain", { pages: measurement.pages, limit: limit ?? "?" });
  }
  return "";
}

const DENSITY_LABEL = {
  roomy: "trial.density.roomy",
  regular: "trial.density.regular",
} as const;

const PHOTO_LABEL = {
  builtin: "trial.photo.builtin",
  custom: "trial.photo.custom",
} as const;

export default function TrialColumn({
  sideLabel,
  state,
  templates,
  currentTemplate,
  capability,
  mode,
  measureEnabled,
  pageLimit,
  hasResumeContent,
  onTemplateChange,
  onRetry,
  onAdopt,
}: Props) {
  useLocale();
  const isCurrent = state.template === currentTemplate;
  const templateLabel =
    templates.find((item) => item.name === state.template)?.label ?? state.template;
  // 只放模板档事实（篇幅 / 照片）；格式能力由 `TrialCapabilityStrip` 按 W11 矩阵显示。
  const capabilityChips = [
    capability.density ? t(DENSITY_LABEL[capability.density]) : null,
    t(PHOTO_LABEL[capability.photo]),
  ].filter((item): item is string => Boolean(item));

  return (
    <section className="template-trial-column" aria-label={sideLabel}>
      <Space size={6} wrap>
        <Typography.Text type="secondary">{sideLabel}</Typography.Text>
        <Select
          size="small"
          style={{ minWidth: 120 }}
          value={state.template}
          aria-label={t("trial.template.label")}
          options={templates.map((item) => ({ value: item.name, label: item.label }))}
          onChange={onTemplateChange}
        />
        <Tag color={isCurrent ? "green" : "blue"}>
          {isCurrent ? t("trial.badge.current") : t("trial.badge.trial")}
        </Tag>
      </Space>

      <div className="template-trial-preview">
        {state.html ? (
          <A4PreviewFrame
            html={withHiddenScrollbar(state.html)}
            title={templateLabel}
            fit="width"
            pages={pageLimit}
          />
        ) : state.htmlError ? (
          <Space orientation="vertical" size={6}>
            <Typography.Text type="danger">
              {state.htmlError || t("trial.preview.failed")}
            </Typography.Text>
            <Button size="small" onClick={onRetry}>
              {t("trial.preview.retry")}
            </Button>
          </Space>
        ) : (
          <LoadingBlock size="small" minHeight={160} />
        )}
      </div>

      <Typography.Text type="secondary" className="template-trial-chips">
        {capabilityChips.join(" · ")}
      </Typography.Text>

      {capability.limitations.map((key) => (
        <Typography.Text key={key} type="secondary" className="template-trial-limit">
          {t(key)}
        </Typography.Text>
      ))}

      <div className="template-trial-measure">
        {!measureEnabled ? (
          <Typography.Text type="secondary">
            {mode === "demo"
              ? t("trial.measure.demo")
              : hasResumeContent
                ? t("trial.measure.unsaved")
                : t("trial.measure.demo")}
          </Typography.Text>
        ) : state.measureLoading ? (
          <Typography.Text type="secondary">{t("trial.measure.loading")}</Typography.Text>
        ) : state.measureError ? (
          <Space size={6}>
            <Typography.Text type="danger">{t("trial.measure.failed")}</Typography.Text>
            <Button size="small" onClick={onRetry}>
              {t("trial.preview.retry")}
            </Button>
          </Space>
        ) : state.measurement ? (
          <Space orientation="vertical" size={2}>
            <Typography.Text>{measurementText(state.measurement)}</Typography.Text>
            {state.measurement.overflow ? (
              <Typography.Text type="warning">{t("trial.measure.overflow")}</Typography.Text>
            ) : null}
          </Space>
        ) : (
          <Typography.Text type="secondary">{t("trial.measure.demo")}</Typography.Text>
        )}
      </div>

      <Tooltip title={isCurrent ? t("trial.adopt.disabled") : undefined}>
        <Button
          type={isCurrent ? "default" : "primary"}
          size="small"
          disabled={isCurrent}
          onClick={onAdopt}
        >
          {isCurrent ? t("trial.adopt.disabled") : t("trial.adopt")}
        </Button>
      </Tooltip>
    </section>
  );
}
