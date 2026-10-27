// SPDX-License-Identifier: Apache-2.0
/** 生成失败阶段：错误信息 + 返回重试 / 重新生成。
 *
 * 纯展示——reset 与 startGenerate 留在 GenerateResumeModal，经 props 回传；零 api 导入。
 */
import { Alert, Button, Space } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  errorMsg: string;
  onReset: () => void;
  onRegenerate: () => void;
}

export default function GenerationErrorStage({ errorMsg, onReset, onRegenerate }: Props) {
  useLocale();
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <Alert
        type="error"
        showIcon
        title={errorMsg || t("generateStages.error.title")}
        style={{ marginBottom: 24 }}
      />
      <Space>
        <Button onClick={onReset}>{t("generateStages.error.back")}</Button>
        <Button type="primary" onClick={onRegenerate}>
          {t("generateStages.action.regenerate")}
        </Button>
      </Space>
    </div>
  );
}
