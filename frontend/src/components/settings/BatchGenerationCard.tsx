// SPDX-License-Identifier: Apache-2.0
/**
 * 设置 · 批量生成简历参数（岗位广场「批量 AI 生成简历」专用）。
 *
 * 没有保存按钮：改动即自动保存（`useBatchSectionAutoSave`）。这一张卡是**默认值入口**：
 * 批量动作时会先弹一张弹窗，用这里的值作初值、可当场覆盖（只作用于那一批）。
 *
 * 字段组本身在 `BatchGenerationFields`，与弹窗共用同一份实现。
 */
import { Card, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { BatchGenerationConfigOut } from "../../api/settingsBatch";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import { useBatchSectionAutoSave } from "../../features/settings/useBatchSectionAutoSave";
import BatchGenerationFields from "./BatchGenerationFields";
import BatchSaveStatus from "./BatchSaveStatus";

export default function BatchGenerationCard({
  section,
  templates,
  fontScales,
}: {
  section: BatchGenerationConfigOut;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
}) {
  useLocale();
  const { draft, status, update } = useBatchSectionAutoSave("generation", section);
  return (
    <Card
      className="batch-config-card"
      title={t("batchOperation.generation.title")}
      extra={<BatchSaveStatus status={status} />}
      styles={{ body: { padding: "14px 20px 16px" } }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("batchOperation.generation.intro")}
      </Typography.Paragraph>
      <BatchGenerationFields
        value={draft}
        onChange={update}
        templates={templates}
        fontScales={fontScales}
      />
    </Card>
  );
}
