/**
 * 准入徽标：展示后端下发的准入结论与"需逐条确认"标记。
 * （自 ApplyQueuePanel 拆出，逐字搬运，行为等价。）
 */
import { Space, Tag } from "antd";
import { ADMISSION_META } from "../../../types";
import type { ApplyQueueItem } from "../../../types";

export function AdmissionTag({ item }: { item: ApplyQueueItem }) {
  if (item.admission === null) {
    // 还没有明确准入结论（admission 为空）时，后端仍可能判定"需逐条确认"
    // （如匹配分析结论为空 → requires_confirm）。此时必须把这个准入要求展示出来，
    // 不能一律显示「未分析」而把"需逐条确认"吞掉。只有既无结论又无需确认时才显示「未分析」。
    return item.requires_confirm ? <Tag color="gold">需逐条确认</Tag> : <Tag>未分析</Tag>;
  }
  const meta = ADMISSION_META[item.admission];
  return (
    <Space size={4} wrap>
      <Tag color={meta.color}>{meta.label}</Tag>
      {item.requires_confirm && <Tag color="gold">需逐条确认</Tag>}
    </Space>
  );
}
