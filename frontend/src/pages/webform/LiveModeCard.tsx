/**
 * 智能逐项填表卡：与「读取当前表单 → 批量填」并存，不是替代。
 * （自 WebFormPage 拆出：:838-909 整块逐字随迁，纯 props——它不做预先快照，
 * 点到哪个框才现场匹配，所以不存在"页面一联动序号就失效"。）
 */
import { Button, Card, Space, Tag, Tooltip, Typography } from "antd";
import type { WebFormLive } from "../../types";
import { LIVE_STATUS_META } from "./constants";
import type { WebFormBusyState } from "./constants";

export function LiveModeCard({
  live,
  liveEnabled,
  running,
  busy,
  rememberPending,
  alternatives,
  onToggle,
  onRequestMemoryDialog,
}: {
  live: WebFormLive | null;
  liveEnabled: boolean;
  running: boolean;
  busy: WebFormBusyState;
  rememberPending: WebFormLive["remember_pending"];
  alternatives: WebFormLive["alternatives"];
  onToggle: () => void;
  onRequestMemoryDialog: () => void;
}) {
  return (
    <Card
      size="small"
      title="智能逐项填表"
      extra={
        <Button
          aria-label={liveEnabled ? "关闭智能逐项填表" : "开启智能逐项填表"}
          type={liveEnabled ? "default" : "primary"}
          loading={busy === "live"}
          // `live.running` 为真时后端一定已经开着浏览器（会话起不来会报 409），
          // 所以它可以单独解除禁用：浏览器状态轮询慢半拍时按钮不会白灰着。
          disabled={!running && !live?.running}
          onClick={onToggle}
        >
          {liveEnabled ? "关闭" : "开启"}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        开启后回到浏览器窗口，
        <Typography.Text strong>点到哪个框，就在框旁边给出资料里对应的值</Typography.Text>
        ，你点「填入」才写进去。认不出来的时候点
        <Typography.Text strong>「换个资料…」</Typography.Text>
        会列出你填过的全部资料（按分区、可搜索），
        <Typography.Text strong>你自己挑一条填</Typography.Text>
        ——所以不必依赖它认得出这个框。适合逐项核对，也能帮到批量填不了的框。
      </Typography.Paragraph>
      {live?.running ? (
        <Space size="middle" wrap>
          <Tag
            color={liveEnabled ? (LIVE_STATUS_META[live.status]?.color ?? "processing") : "default"}
          >
            {liveEnabled ? (LIVE_STATUS_META[live.status]?.label ?? "等待你点某个框") : "已关闭"}
          </Tag>
          {liveEnabled && live.field_label ? (
            <Typography.Text>
              {live.field_label}
              {live.value ? ` → ${live.value}` : ""}
            </Typography.Text>
          ) : null}
          {liveEnabled && live.source === "ai" ? <Tag color="blue">AI 建议</Tag> : null}
          {liveEnabled && alternatives.length ? (
            <Tooltip title={alternatives.map((item) => `${item.label}：${item.value}`).join("\n")}>
              <Typography.Text type="secondary">
                另有 {alternatives.length} 个候选（在浏览器窗口里点选）
              </Typography.Text>
            </Tooltip>
          ) : null}
          {liveEnabled && live.note ? (
            <Typography.Text type="secondary">{live.note}</Typography.Text>
          ) : null}
          {liveEnabled && rememberPending ? (
            <>
              <Tag color="warning">等待选择资料目标</Tag>
              <Button size="small" onClick={onRequestMemoryDialog}>
                选择保存位置
              </Button>
            </>
          ) : null}
          <Typography.Text type="secondary">
            {liveEnabled ? `本次已填 ${live.filled} 个` : "悬浮球仍在浏览器中，可随时重新开启"}
          </Typography.Text>
        </Space>
      ) : (
        <Typography.Text type="secondary">未开启</Typography.Text>
      )}
    </Card>
  );
}
