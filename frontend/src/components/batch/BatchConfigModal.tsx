// SPDX-License-Identifier: Apache-2.0
/**
 * 批量动作的「设置本次参数」弹窗（生成 / 导出两模式）。
 *
 * **为什么要把设置搬到这里**：以前点批量动作只会弹一句"去设置"，跳转会卸载岗位页、
 * 把已勾选的岗位一起带走。参数本该在触发点上改，而且**只作用于这一批**——关掉即弃，
 * 不写回设置页的默认值（那两张卡仍是默认值入口）。
 *
 * 打开时**重读**一次全局配置当初值（不吃缓存，与旧守卫每次点击都重读一致）；读不到或
 * 从未配置时用与后端默认一致的兜底值，并在顶部说明"当前是默认参数"，不能让弹窗开成空白。
 */
import { Alert, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { fetchResumeTemplates } from "../../api/resumes";
import type { BatchExportConfig, BatchGenerationConfig } from "../../api/settingsBatch";
import { MAX_BATCH_EXPORT } from "../../api/resumeBatchExport";
import { useBatchOperationConfig } from "../../features/settings/useBatchOperationConfig";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import { useFormDraft } from "../../hooks/useFormDraft";
import FormModal from "../common/FormModal";
import LoadingBlock from "../common/LoadingBlock";
import BatchExportFields from "../settings/BatchExportFields";
import BatchGenerationFields from "../settings/BatchGenerationFields";

export type BatchConfigMode = "generation" | "export";
export type BatchConfigValues = BatchGenerationConfig | BatchExportConfig;

/** 与 `schemas/batch_operation.py` 的默认值逐字对齐：未配置时打开的就是后端会用的那一套。 */
const DEFAULT_GENERATION: BatchGenerationConfig = {
  template: "classic",
  format_name: "",
  font_scale: "standard",
  page_limit: 1,
  language: "zh-CN",
  enhance: false,
  enhancement_level: "balanced",
  custom_instruction: "",
};

const DEFAULT_EXPORT: BatchExportConfig = {
  template: "classic",
  format_name: "",
  font_scale: "standard",
  page_limit: 1,
  language: "zh-CN",
  export_format: "pdf",
};

export interface BatchConfigModalProps {
  open: boolean;
  mode: BatchConfigMode;
  /** 本次将处理的条数（岗位数 / 简历份数），用于正文那句"本次将为 N 个…"。 */
  count: number;
  onCancel: () => void;
  onConfirm: (config: BatchConfigValues) => void;
}

export default function BatchConfigModal({
  open,
  mode,
  count,
  onCancel,
  onConfirm,
}: BatchConfigModalProps) {
  useLocale();
  const { refresh } = useBatchOperationConfig();
  const [generation, setGeneration] = useState<BatchGenerationConfig>(DEFAULT_GENERATION);
  const [exportConfig, setExportConfig] = useState<BatchExportConfig>(DEFAULT_EXPORT);
  const [templates, setTemplates] = useState<ResumeTemplateOption[]>([]);
  const [fontScales, setFontScales] = useState<ResumeFontScaleOption[]>([]);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // "初值"的 JSON：用来判断有没有改过（关闭时要不要问），也用来决定要不要写草稿。
  const [baseline, setBaseline] = useState<string | null>(null);

  // 每次打开都回到"读取中"：不在 effect 里同步 setState（那会多一轮级联渲染），
  // 用"入参变了就重置派生状态"的渲染期比较，与 `useDiscardGuard` 同一做法。
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (open) {
      setLoading(true);
      setLoaded(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void (async () => {
      // 目录只用来填下拉：取不到就退回数值/当前值，不让整个弹窗打不开。
      const [config, catalog] = await Promise.all([
        refresh(),
        fetchResumeTemplates().catch(() => null),
      ]);
      if (cancelled) return;
      setTemplates(catalog?.templates ?? []);
      setFontScales(catalog?.font_scales ?? []);
      if (config) {
        // 只取可配置字段：`configured` / `updated_at` 是服务端元信息，不该进本次参数。
        // 未配置时不用服务端返回的那份（老后端可能是空壳），直接用与后端默认一致的兜底值。
        if (mode === "generation") {
          const next = config.generation.configured
            ? pickGeneration(config.generation)
            : DEFAULT_GENERATION;
          setUsingDefaults(!config.generation.configured);
          setGeneration(next);
          setBaseline(JSON.stringify(next));
        } else {
          const next = config.export.configured ? pickExport(config.export) : DEFAULT_EXPORT;
          setUsingDefaults(!config.export.configured);
          setExportConfig(next);
          setBaseline(JSON.stringify(next));
        }
      } else {
        // 读不到（老后端 / 临时故障）按"未配置"处理：用默认值先把弹窗开出来。
        setUsingDefaults(true);
        const next = mode === "generation" ? DEFAULT_GENERATION : DEFAULT_EXPORT;
        if (mode === "generation") setGeneration(next as BatchGenerationConfig);
        else setExportConfig(next as BatchExportConfig);
        setBaseline(JSON.stringify(next));
      }
      setLoading(false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, refresh]);

  const values: BatchConfigValues = mode === "generation" ? generation : exportConfig;
  const serialized = JSON.stringify(values);
  const dirty = loaded && baseline !== null && serialized !== baseline;
  // 与初值一致时不写草稿：否则每次打开都会冒出一条"恢复默认参数"。
  const isEmpty = useCallback(
    (next: Record<string, unknown>) => JSON.stringify(next) === baseline,
    [baseline],
  );

  const draft = useFormDraft({
    // 草稿按"哪一节的参数"分：生成与导出互不串味。
    scope: `batchConfig.${mode}`,
    values: values as unknown as Record<string, unknown>,
    open,
    enabled: open && loaded,
    isEmpty,
  });

  const restoreDraft = (): void => {
    const restored = draft.adopt();
    if (!restored) return;
    if (mode === "generation") {
      setGeneration((previous) => ({ ...previous, ...restored }) as BatchGenerationConfig);
    } else {
      setExportConfig((previous) => ({ ...previous, ...restored }) as BatchExportConfig);
    }
  };

  const overLimit = mode === "export" && count > MAX_BATCH_EXPORT;

  const submit = async (): Promise<void> => {
    if (overLimit) return;
    setSubmitting(true);
    try {
      // 确认即"这套参数被这一批消费掉"：清草稿，下次打开回到默认值。
      draft.clear();
      onConfirm(values);
    } finally {
      setSubmitting(false);
    }
  };

  const countText =
    mode === "generation"
      ? t("batchOperation.modal.count.generation", { count })
      : t("batchOperation.modal.count.export", { count });

  return (
    <FormModal
      open={open}
      title={
        mode === "generation"
          ? t("batchOperation.modal.title.generation")
          : t("batchOperation.modal.title.export")
      }
      okText={
        mode === "generation"
          ? t("batchOperation.modal.start.generation")
          : t("batchOperation.modal.start.export")
      }
      okDisabled={overLimit}
      submitting={submitting}
      dirty={dirty}
      hasDraft={draft.pending !== null}
      draftBar={
        draft.pending
          ? {
              savedAt: draft.pending.savedAt,
              fieldCount: Object.keys(draft.pending.values).length,
              onRestore: restoreDraft,
              onDiscard: draft.discard,
            }
          : null
      }
      onCancel={onCancel}
      onSubmit={submit}
      width={640}
    >
      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {usingDefaults ? (
            <Alert
              type="info"
              showIcon
              className="batch-config-modal-note"
              title={t("batchOperation.modal.defaults")}
            />
          ) : null}
          {mode === "generation" ? (
            <BatchGenerationFields
              compact
              value={generation}
              onChange={(key, value) =>
                setGeneration((previous) => ({ ...previous, [key]: value }))
              }
              templates={templates}
              fontScales={fontScales}
            />
          ) : (
            <BatchExportFields
              compact
              value={exportConfig}
              onChange={(key, value) =>
                setExportConfig((previous) => ({ ...previous, [key]: value }))
              }
              templates={templates}
              fontScales={fontScales}
            />
          )}
          <Typography.Paragraph strong className="batch-config-modal-count">
            {countText}
          </Typography.Paragraph>
          {overLimit ? (
            <Alert
              type="warning"
              showIcon
              className="batch-config-modal-note"
              title={t("batchOperation.modal.exportLimit", { limit: MAX_BATCH_EXPORT })}
            />
          ) : null}
          <Typography.Paragraph type="secondary" className="batch-config-modal-scope">
            {t("batchOperation.modal.scope")}
          </Typography.Paragraph>
        </>
      )}
    </FormModal>
  );
}

/** 只取可配置字段：`configured` / `updated_at` 是服务端元信息，不该进本次参数。 */
function pickGeneration(section: BatchGenerationConfig): BatchGenerationConfig {
  return {
    template: section.template,
    format_name: section.format_name,
    font_scale: section.font_scale,
    page_limit: section.page_limit,
    language: section.language,
    enhance: section.enhance,
    enhancement_level: section.enhancement_level,
    custom_instruction: section.custom_instruction,
  };
}

function pickExport(section: BatchExportConfig): BatchExportConfig {
  return {
    template: section.template,
    format_name: section.format_name,
    font_scale: section.font_scale,
    page_limit: section.page_limit,
    language: section.language,
    export_format: section.export_format,
  };
}
