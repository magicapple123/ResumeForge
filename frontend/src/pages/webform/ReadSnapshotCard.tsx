// SPDX-License-Identifier: Apache-2.0
/**
 * 步骤条 + 读取卡：读取当前表单的入口与快照摘要。
 * （自 WebFormPage 拆出：:911-945 整块逐字随迁，纯 props。）
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Button, Card, Space, Steps, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormSnapshot } from "../../types";
import type { WebFormBusyState } from "./constants";

/**
 * **memo**：props 全部在击键路径上稳定（step/running/busy/snapshot 与稳定的 onRead），
 * 打字时整块跳过重渲。
 */
export const ReadSnapshotCard = memo(function ReadSnapshotCard({
  step,
  running,
  busy,
  snapshot,
  onRead,
}: {
  step: number;
  running: boolean;
  busy: WebFormBusyState;
  snapshot: WebFormSnapshot | null;
  onRead: () => void;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后步骤条与摘要不重渲染。
  useLocale();
  return (
    <>
      {/* 本组件在父级 Space 里只占一个 item（memo 包着的 fragment 不会被拍平），
          Steps 与下方 Card 之间没有现成的间距可蹭——补 12px，避免步骤行贴住卡片边框。 */}
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 12 }}
        items={[
          { title: t("webFormPage.readSnapshot.step.startBrowser") },
          { title: t("webFormPage.readSnapshot.step.openPage") },
          { title: t("webFormPage.readSnapshot.step.reviewMapping") },
          { title: t("webFormPage.readSnapshot.step.fill") },
        ]}
      />

      <Card size="small">
        <Space size="middle" wrap>
          <Button
            type="primary"
            icon={<FileSearchOutlined />}
            disabled={!running}
            loading={busy === "read"}
            onClick={onRead}
          >
            {t("webFormPage.readSnapshot.read")}
          </Button>
          <Typography.Text type="secondary">{t("webFormPage.readSnapshot.hint")}</Typography.Text>
        </Space>
        {snapshot ? (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary">
              {t("webFormPage.readSnapshot.summary", {
                title: snapshot.page.title || t("webFormPage.readSnapshot.untitled"),
                url: snapshot.page.url,
                count: snapshot.page.control_count,
              })}
            </Typography.Text>
          </div>
        ) : null}
      </Card>
    </>
  );
});
