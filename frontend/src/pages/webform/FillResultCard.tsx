// SPDX-License-Identifier: Apache-2.0
/**
 * 填充结果卡：成功/待确认/失败计数、成功率与未落定项明细。
 * （自 WebFormPage 拆出：:986-1014 整块逐字随迁，内用 FillRateTag，纯 props。）
 */
import { Alert, Card, Space, Tag, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormFillResult } from "../../types";
import { FillRateTag } from "./FillRateTag";

/** **memo**：只在 result 引用变化（填充完成后）时才需要重渲。 */
export const FillResultCard = memo(function FillResultCard({
  result,
}: {
  result: WebFormFillResult;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这张卡不重渲染。
  useLocale();
  return (
    <Card size="small" title={t("webFormPage.fillResult.title")}>
      <Space size="middle" wrap>
        <Tag color="success">
          {t("webFormPage.fillResult.tag.filled", { count: result.filled })}
        </Tag>
        {result.unverified ? (
          <Tag color="warning">
            {t("webFormPage.fillResult.tag.unverified", { count: result.unverified })}
          </Tag>
        ) : null}
        {result.failed ? (
          <Tag color="error">
            {t("webFormPage.fillResult.tag.failed", { count: result.failed })}
          </Tag>
        ) : null}
        <FillRateTag filled={result.filled} total={result.form_control_total} />
      </Space>
      {result.unverified || result.failed ? (
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          {result.outcomes
            .filter((outcome) => outcome.status === "unverified" || outcome.status === "failed")
            .map((outcome) => (
              <li key={outcome.index}>
                <Typography.Text type="secondary">
                  {t("webFormPage.fillResult.outcome", {
                    index: outcome.index + 1,
                    detail: outcome.detail || outcome.status,
                  })}
                </Typography.Text>
              </li>
            ))}
        </ul>
      ) : null}
      <Alert
        style={{ marginTop: 12 }}
        type="info"
        showIcon
        title={t("webFormPage.fillResult.verifyHint")}
      />
    </Card>
  );
});
