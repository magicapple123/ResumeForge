/**
 * 一键填充成功率：按「成功填写 / 页面表单控件总数」计。
 * （自 WebFormPage 拆出，逐字搬运。）
 */
import { Tag } from "antd";

export function FillRateTag({ filled, total }: { filled: number; total?: number }) {
  if (!total || total <= 0) return null;
  return (
    <Tag color="processing">
      成功率 {Math.round((filled * 100) / total)}%（{filled}/{total}）
    </Tag>
  );
}
