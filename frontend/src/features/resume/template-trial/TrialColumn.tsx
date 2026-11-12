// SPDX-License-Identifier: Apache-2.0
/**
 * W10 对比视图的一栏：模板选择 + 真实渲染预览 + 实际页数/溢出 + 能力与已知差异 + 采纳。
 *
 * 一栏只负责"展示与动作"，取数在 `useTemplateTrial`；两侧共用本组件，避免左右各写一份。
 * 页数措辞与精确预览/制作台同一套；示例模式**不显示页数**（见 `measure` 分支）。
 */
import { Button, Popconfirm, Select, Space, Tag, Tooltip, Typography } from "antd";
import LoadingBlock from "../../../components/common/LoadingBlock";
import A4PreviewFrame from "../../templates/A4PreviewFrame";
import { t } from "../../../i18n";
import type { ResumeTemplateOption } from "../../../types";
import type { TrialMeasurement, TrialSideState } from "./types";
import { previewPageCount } from "./trialRequests";
import type { TemplateCapability } from "./templateProfile";
import { withHiddenScrollbar } from "../../../utils/iframeDocument";
import { useLocale } from "../../../i18n/i18nContext";
import { resumeTemplateLabel } from "../../../i18n/enum/resumeCatalog";

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
  /**
   * 覆盖策略是「采用模板默认」：采纳会**清空整份 `format_config`**（字号/行距/颜色/
   * 局部排版全没），所以采纳必须二次确认，文案写清代价。
   */
  resetOverrides: boolean;
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
  resetOverrides,
  onTemplateChange,
  onRetry,
  onAdopt,
}: Props) {
  useLocale();
  const isCurrent = state.template === currentTemplate;
  const chosen = templates.find((item) => item.name === state.template);
  const templateLabel = chosen ? resumeTemplateLabel(chosen) : state.template;
  // 「采用模板默认」的采纳会清空整份 format_config：写回前必须先让用户看清代价。
  const needsConfirm = resetOverrides && !isCurrent;
  // 只放模板档事实（篇幅 / 照片）；格式能力由 `TrialCapabilityStrip` 按 W11 矩阵显示。
  const capabilityChips = [
    capability.density ? t(DENSITY_LABEL[capability.density]) : null,
    t(PHOTO_LABEL[capability.photo]),
  ].filter((item): item is string => Boolean(item));
  // 需要二次确认时，点击由 Popconfirm 的 onConfirm 承接，按钮自身不再直接写回。
  const adoptButton = (
    <Button
      type={isCurrent ? "default" : "primary"}
      size="small"
      disabled={isCurrent}
      onClick={needsConfirm ? undefined : onAdopt}
    >
      {isCurrent ? t("trial.adopt.disabled") : t("trial.adopt")}
    </Button>
  );

  return (
    <section className="template-trial-column" aria-label={sideLabel}>
      <Space size={6} wrap>
        <Typography.Text type="secondary">{sideLabel}</Typography.Text>
        <Select
          size="small"
          style={{ minWidth: 120 }}
          value={state.template}
          aria-label={t("trial.template.label")}
          options={templates.map((item) => ({
            value: item.name,
            label: resumeTemplateLabel(item),
          }))}
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
            // 与请求体的 `page_limit` 同一个口径（示例恒 1 页）：HTML 的 body 高度与画布
            // 页数必须一致，否则"示例只有一页正文、纸面仍按最大篇幅撑高"（见 previewPageCount）。
            pages={previewPageCount(mode, pageLimit)}
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

      {isCurrent ? (
        <Tooltip title={t("trial.adopt.disabled")}>{adoptButton}</Tooltip>
      ) : needsConfirm ? (
        // 二次确认：确认按钮才真正调 onAdopt（宿主据此清空 format_config 并换模板）。
        <Popconfirm
          title={t("trial.override.confirmTitle")}
          description={t("trial.override.confirmBody", { name: templateLabel })}
          okText={t("trial.override.confirmOk")}
          cancelText={t("trial.override.confirmCancel")}
          okButtonProps={{ danger: true }}
          onConfirm={onAdopt}
        >
          {adoptButton}
        </Popconfirm>
      ) : (
        adoptButton
      )}
    </section>
  );
}
