/**
 * 预览核对卡：勾选要填的项、手改值、采纳 AI 建议、填充到页面。
 * （自 WebFormPage 拆出：:947-984 整块逐字随迁，纯 props。）
 */
import { Button, Card, Empty, Space } from "antd";
import WebFormPreviewTable from "../../components/webform/WebFormPreviewTable";
import type { WebFormPreview } from "../../types";
import type { WebFormBusyState } from "./constants";

export function PreviewCard({
  preview,
  selected,
  values,
  aiSuggestions,
  busy,
  running,
  onSelectAiSuggestions,
  onFill,
  onToggle,
  onValueChange,
}: {
  preview: WebFormPreview;
  selected: Set<number>;
  values: Record<number, string>;
  aiSuggestions: WebFormPreview["items"];
  busy: WebFormBusyState;
  running: boolean;
  onSelectAiSuggestions: () => void;
  onFill: () => void;
  onToggle: (index: number) => void;
  onValueChange: (index: number, value: string) => void;
}) {
  return (
    <Card
      size="small"
      title={`核对后填充（已选 ${selected.size} / ${preview.items.length} 项）`}
      extra={
        <Space size="small">
          {/* AI 建议默认不勾——失败形态是"我忘了勾"，而不是"悄悄写了个错值"。
              想一次全采纳，这里点一下就好。 */}
          {aiSuggestions.length ? (
            <Button onClick={onSelectAiSuggestions} disabled={busy === "fill"}>
              全选 AI 建议（{aiSuggestions.length}）
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={busy === "fill"}
            disabled={!running || selected.size === 0}
            onClick={onFill}
          >
            填充到页面
          </Button>
        </Space>
      }
    >
      {preview.items.length ? (
        <WebFormPreviewTable
          items={preview.items}
          selected={selected}
          values={values}
          disabled={busy === "fill"}
          onToggle={onToggle}
          onValueChange={onValueChange}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可自动填的字段" />
      )}
    </Card>
  );
}
