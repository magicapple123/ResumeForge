// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「批量操作」：读一次目录与两套参数，渲染**两张互不影响的卡**。
 *
 * 这里不再有「保存参数」按钮：卡片内部改动即自动保存（见 `useBatchSectionAutoSave`）。
 * 生成与导出分开配置——它们的取舍不同，共用一套会让"改导出格式"顺带改掉生成行为。
 */
import { Alert, App, Space } from "antd";
import { useCallback, useEffect, useState } from "react";
import { fetchResumeTemplates } from "../../api/resumes";
import { getBatchOperationConfig, type BatchOperationConfigOut } from "../../api/settingsBatch";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import LoadingBlock from "../common/LoadingBlock";
import BatchExportCard from "./BatchExportCard";
import BatchGenerationCard from "./BatchGenerationCard";

interface LoadedState {
  config: BatchOperationConfigOut;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
}

export default function BatchOperationCard() {
  useLocale();
  const { message } = App.useApp();
  const [state, setState] = useState<LoadedState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [config, catalog] = await Promise.all([
        getBatchOperationConfig(),
        // 目录只用来填下拉选项：取不到就退回数值/当前值，不让整张卡打不开。
        fetchResumeTemplates().catch(() => null),
      ]);
      setState({
        config,
        templates: catalog?.templates ?? [],
        fontScales: catalog?.font_scales ?? [],
      });
    } catch (err) {
      setState(null);
      setFailed(true);
      message.error(err instanceof Error ? err.message : t("batchOperation.loadFailed"));
    }
  }, [message]);

  useEffect(() => {
    // 延后一拍：同一次挂载里读两个端点，没必要在首帧之前发。
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (failed) {
    return <Alert type="error" showIcon title={t("batchOperation.loadFailed")} />;
  }
  if (!state) {
    return <LoadingBlock />;
  }
  return (
    <Space id="batch-operation" orientation="vertical" size={12} style={{ width: "100%" }}>
      <BatchGenerationCard
        section={state.config.generation}
        templates={state.templates}
        fontScales={state.fontScales}
      />
      <BatchExportCard
        section={state.config.export}
        templates={state.templates}
        fontScales={state.fontScales}
      />
    </Space>
  );
}
