/**
 * 步骤条 + 读取卡：读取当前表单的入口与快照摘要。
 * （自 WebFormPage 拆出：:911-945 整块逐字随迁，纯 props。）
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Button, Card, Space, Steps, Typography } from "antd";
import { memo } from "react";
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
  return (
    <>
      <Steps
        size="small"
        current={step}
        items={[
          { title: "启动浏览器" },
          { title: "打开网申页" },
          { title: "核对映射" },
          { title: "填充" },
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
            读取当前表单
          </Button>
          <Typography.Text type="secondary">
            先在浏览器窗口里打开网申表单页，停在要填的那一步，再点这里。
          </Typography.Text>
        </Space>
        {snapshot ? (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary">
              已读取：{snapshot.page.title || "（无标题）"} · {snapshot.page.url} · 共{" "}
              {snapshot.page.control_count} 个控件
            </Typography.Text>
          </div>
        ) : null}
      </Card>
    </>
  );
});
