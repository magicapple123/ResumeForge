// SPDX-License-Identifier: Apache-2.0
/**
 * 设置 · 批量导出简历参数（简历中心「批量导出」专用）。
 *
 * 与生成卡分开存储：改导出格式不会影响下一次批量生成。改动即自动保存。这一张卡是
 * **默认值入口**：批量导出时会先弹一张弹窗，用这里的值作初值、可当场覆盖（只作用于这一批）。
 *
 * 字段组本身在 `BatchExportFields`，与弹窗共用同一份实现。
 */
import { Card, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { BatchExportConfigOut } from "../../api/settingsBatch";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import { useBatchSectionAutoSave } from "./useBatchSectionAutoSave";
import BatchExportFields from "./BatchExportFields";
import BatchSaveStatus from "./BatchSaveStatus";

export default function BatchExportCard({
  section,
  templates,
  fontScales,
}: {
  section: BatchExportConfigOut;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
}) {
  useLocale();
  const { draft, status, update } = useBatchSectionAutoSave("export", section);
  return (
    <Card
      className="batch-config-card"
      title={t("batchOperation.export.title")}
      extra={<BatchSaveStatus status={status} />}
      styles={{ body: { padding: "14px 20px 16px" } }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("batchOperation.export.intro")}
      </Typography.Paragraph>
      <BatchExportFields
        value={draft}
        onChange={update}
        templates={templates}
        fontScales={fontScales}
      />
    </Card>
  );
}
