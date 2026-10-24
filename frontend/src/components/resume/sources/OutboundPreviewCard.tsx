// SPDX-License-Identifier: Apache-2.0
/**
 * 外发前预览（R04）：把"这次要发什么"完整摆出来——目标服务、资料类别、附件类型、
 * 已排除字段、是否抓取正文、以及正文本身。
 *
 * ## 隐私边界（结构性，不靠自觉）
 *
 * 契约 §5：预览正文只存在于**本次响应与内存**。本组件：
 * 1. 不写 localStorage/sessionStorage、不 console 输出正文；
 * 2. 不在卸载时把正文搬到任何全局 store；
 * 3. 正文只在 `preview.body_preview` 上渲染，父组件刷新即丢弃。
 *
 * `secret_leak_detected` 只给 boolean（服务端不回显命中片段），这里也只提示"检测到疑似密钥"。
 */
import { Alert, Button, Descriptions, Space, Tag, Typography } from "antd";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { pt } from "../../../features/resume-provenance/i18n";
import type { OutboundPreviewOut } from "../../../features/resume-provenance/types";

interface Props {
  preview: OutboundPreviewOut | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 确认外发（真正发送动作在宿主；本组件只给入口）。 */
  onConfirm?: () => void;
}

function listText(values: string[]): string {
  return values.length > 0 ? values.join(" · ") : pt("provenance.outbound.none");
}

export default function OutboundPreviewCard({
  preview,
  loading = false,
  error = null,
  onRetry,
  onConfirm,
}: Props) {
  if (error) {
    return <ErrorState description={error} onRetry={onRetry} />;
  }
  if (loading) {
    return <LoadingBlock tip={pt("provenance.outbound.title")} />;
  }
  if (!preview) return null;

  return (
    <div data-outbound-preview="1">
      <Space size={6} align="center" style={{ marginBottom: 6 }}>
        <Typography.Text strong>{pt("provenance.outbound.title")}</Typography.Text>
        <Tag color="blue">{pt("provenance.outbound.memoryOnly")}</Tag>
      </Space>

      {preview.secret_leak_detected ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={pt("provenance.outbound.secretLeak")}
          description={pt("provenance.outbound.secretLeak.hint")}
        />
      ) : null}

      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label={pt("provenance.outbound.target")}>
          {preview.target_service}
        </Descriptions.Item>
        <Descriptions.Item label={pt("provenance.outbound.materials")}>
          {listText(preview.material_categories)}
        </Descriptions.Item>
        <Descriptions.Item label={pt("provenance.outbound.attachments")}>
          {listText(preview.attachment_types)}
        </Descriptions.Item>
        <Descriptions.Item label={pt("provenance.outbound.excluded")}>
          {listText(preview.excluded_fields)}
        </Descriptions.Item>
        <Descriptions.Item label={pt("provenance.outbound.fetchPages")}>
          {preview.fetch_pages
            ? pt("provenance.outbound.fetchPages.yes")
            : pt("provenance.outbound.fetchPages.no")}
        </Descriptions.Item>
        <Descriptions.Item label={pt("provenance.outbound.body")}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {pt("provenance.outbound.bodyChars", { count: preview.body_chars })}
          </Typography.Text>
          {preview.body_truncated ? (
            <div>
              <Tag color="orange">{pt("provenance.outbound.truncated")}</Tag>
            </div>
          ) : null}
          <pre
            data-outbound-body="1"
            style={{
              marginTop: 6,
              maxHeight: 240,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 12,
            }}
          >
            {preview.body_preview}
          </pre>
        </Descriptions.Item>
      </Descriptions>

      {onConfirm ? (
        <Button
          type="primary"
          style={{ marginTop: 8 }}
          aria-label={pt("provenance.outbound.confirm")}
          onClick={onConfirm}
        >
          {pt("provenance.outbound.confirm")}
        </Button>
      ) : null}
    </div>
  );
}
