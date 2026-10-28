// SPDX-License-Identifier: Apache-2.0
/**
 * W10 试用与对比视图（模板图库内的一个视图，不叠第二个弹窗）。
 *
 * ## 一次会话看得清四件事
 *
 * 1. 预览内容是**示例**还是**我的内容**（示例不测篇幅，避免"示例放得下"的误导）；
 * 2. 两套模板并排、正文与排版参数一致；
 * 3. 我的内容下的**真实页数 / 溢出**（来自后端 PDF 排版的响应头，不模拟分页）；
 * 4. 采纳时**保留当前排版覆盖**还是**采用模板默认**，以及各模板的已知格式差异。
 *
 * ## 取消不污染文档
 *
 * 本组件只持有试用会话状态；`onBack`/`onAdopt` 之外没有任何写回。采纳由宿主的
 * `onTrialAdopt` 落一次 layout（进统一历史），返回图库即结束试用。
 */
import { App, Button, Radio, Segmented, Space, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import type {
  ResumeContent,
  ResumeFormatConfig,
  ResumeLayout,
  ResumeTemplateCatalog,
} from "../../../types";
import { templateCapability } from "../../../features/resume-template-trial/templateProfile";
import { useTemplateTrial } from "../../../features/resume-template-trial/useTemplateTrial";
import type { TrialAdoptRequest } from "../../../features/resume-template-trial/types";
import { runPreflight } from "../../../features/resume-preflight/preflightApi";
import TrialCapabilityStrip from "./TrialCapabilityStrip";
import TrialColumn from "./TrialColumn";
import { useLocale } from "../../../i18n/i18nContext";
import { resumeTemplateLabel } from "../../../i18n/enum/resumeCatalog";

interface Props {
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  resumeId?: number | null;
  content?: ResumeContent | null;
  /** 从图库某张卡片点"试用"进来时指定右侧模板。 */
  initialTemplate?: string | null;
  /** 宿主是否提供"重设排版覆盖"的通道（没有时如实禁用该选项）。 */
  canResetOverrides: boolean;
  /**
   * 格式能力矩阵（`PreflightOut.capabilities` 原样）。宿主已有检查结果时直接传入，
   * 省一次"为了看能力而跑检查"的请求；不传时本组件在**有简历 id** 的前提下向
   * W11 检查端点要一份（只跑便宜的 content 层，能力矩阵总是随响应下发）。
   */
  capabilities?: Record<string, string> | null;
  /** 退出对比视图（不改文档）。 */
  onBack: () => void;
  onAdopt: (request: TrialAdoptRequest) => void;
}

export default function TemplateTrialPanel({
  layout,
  catalog,
  resumeId,
  content,
  initialTemplate,
  canResetOverrides,
  capabilities,
  onBack,
  onAdopt,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const trial = useTemplateTrial({
    open: true,
    layout,
    catalog,
    resumeId,
    content,
    initialTemplate,
  });
  const [matrix, setMatrix] = useState<Record<string, string> | null>(capabilities ?? null);
  // 能力矩阵是**可选信息**：拿不到不影响试用（预览/测量才是主体），所以失败静默。
  useEffect(() => {
    if (matrix || !resumeId) return;
    let cancelled = false;
    const controller = new AbortController();
    void runPreflight(resumeId, { layers: ["content"] }, controller.signal)
      .then((result) => {
        if (!cancelled) setMatrix(result.capabilities ?? null);
      })
      .catch(() => {
        // 静默：能力说明缺失时下方显示"暂不可用"。
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [matrix, resumeId]);
  const pageLimit = Number(layout.page_limit) || 1;
  const hasResumeContent = Boolean(resumeId || content);

  const optionOf = (name: string) =>
    trial.choices.find((item) => item.name === name) ?? {
      name,
      label: name,
      description: "",
    };

  const adopt = (template: string) => {
    const formatConfig: ResumeFormatConfig = trial.useOverrides
      ? { ...(layout.format_config ?? {}) }
      : {};
    onAdopt({ template, formatConfig });
    message.success(t("trial.adopt.done", { name: resumeTemplateLabel(optionOf(template)) }));
  };

  return (
    <div className="template-trial">
      <Space size={10} wrap className="template-trial-toolbar">
        <Typography.Text strong>{t("trial.title")}</Typography.Text>
        <Typography.Text type="secondary">{t("trial.hint")}</Typography.Text>
        <Segmented
          size="small"
          value={trial.mode}
          aria-label={t("trial.mode.label")}
          options={[
            { value: "demo", label: t("trial.mode.demo") },
            {
              value: "current",
              label: t("trial.mode.current"),
              disabled: !trial.currentAvailable,
            },
          ]}
          onChange={(value) => trial.setMode(value as "demo" | "current")}
        />
        {!trial.currentAvailable ? (
          <Tooltip title={t("trial.mode.unavailable")}>
            <Typography.Text type="secondary">{t("trial.mode.demoNote")}</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">
            {trial.mode === "demo" ? t("trial.mode.demoNote") : t("trial.mode.currentNote")}
          </Typography.Text>
        )}
        <Radio.Group
          size="small"
          value={trial.useOverrides ? "keep" : "reset"}
          onChange={(event) => trial.setUseOverrides(event.target.value === "keep")}
        >
          <Radio.Button value="keep">
            <Tooltip title={t("trial.override.keepHint")}>{t("trial.override.keep")}</Tooltip>
          </Radio.Button>
          <Tooltip
            title={
              canResetOverrides ? t("trial.override.resetHint") : t("trial.override.unavailable")
            }
          >
            <Radio.Button value="reset" disabled={!canResetOverrides}>
              {t("trial.override.reset")}
            </Radio.Button>
          </Tooltip>
        </Radio.Group>
        <Button size="small" onClick={onBack}>
          {t("trial.action.back")}
        </Button>
      </Space>

      <div className="template-trial-columns">
        <TrialColumn
          sideLabel={t("trial.side.left")}
          state={trial.states.left}
          templates={trial.choices}
          currentTemplate={layout.template}
          capability={templateCapability(optionOf(trial.left), catalog)}
          mode={trial.mode}
          measureEnabled={trial.measureEnabled}
          pageLimit={pageLimit}
          hasResumeContent={hasResumeContent}
          onTemplateChange={(name) => trial.setSideTemplate("left", name)}
          onRetry={() => trial.retry("left")}
          onAdopt={() => adopt(trial.left)}
        />
        <TrialColumn
          sideLabel={t("trial.side.right")}
          state={trial.states.right}
          templates={trial.choices}
          currentTemplate={layout.template}
          capability={templateCapability(optionOf(trial.right), catalog)}
          mode={trial.mode}
          measureEnabled={trial.measureEnabled}
          pageLimit={pageLimit}
          hasResumeContent={hasResumeContent}
          onTemplateChange={(name) => trial.setSideTemplate("right", name)}
          onRetry={() => trial.retry("right")}
          onAdopt={() => adopt(trial.right)}
        />
      </div>

      {matrix ? (
        <TrialCapabilityStrip capabilities={matrix} />
      ) : resumeId ? (
        <Typography.Text type="secondary">{t("trial.capability.pending")}</Typography.Text>
      ) : null}
      <Typography.Text type="secondary">{t("trial.export.wordNote")}</Typography.Text>
    </div>
  );
}
