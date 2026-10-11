/**
 * 版本信息位（RF-17）：一份简历的版本血缘与投递记录。
 *
 * 诚实口径——不臆造历史：
 * - 有交付记录时逐条列出「已投递给谁（时间 · 内容指纹前 8 位）」；
 * - 没有交付记录且无血缘 → 「独立版本」；
 * - 血缘指向的父简历信息后端只给 id，直接以 id 表述，不猜它的标题。
 *
 * 数据在弹窗打开时按需拉取（详情打开才取一次），失败静默——投递记录是补充信息，
 * 加载不出来不该挡住简历预览本身。
 */
import { Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { listResumeDeliveries } from "../../api/resumes";
import type { DeliverySummary } from "../../types";

const DELIVERY_SOURCE_LABELS: Record<string, string> = {
  apply: "投递台",
  track: "进度关联",
  export: "导出存档",
};

interface Props {
  recordId: number;
  /** 版本血缘（RF-17）：由哪份简历派生而来；null = 独立版本。 */
  parentRevisionId: number | null;
}

export default function ResumeDeliveryInfo({ recordId, parentRevisionId }: Props) {
  const [deliveries, setDeliveries] = useState<DeliverySummary[] | null>(null);

  // Compiler 规范：随 recordId 变化的重置用渲染期守卫式调整（含首次挂载），
  // 不在 effect 里同步 setState（避免级联渲染，见 ResumeDetailModal 同款处理）。
  const [prevRecordId, setPrevRecordId] = useState(recordId);
  if (prevRecordId !== recordId) {
    setPrevRecordId(recordId);
    setDeliveries(null);
  }

  useEffect(() => {
    let cancelled = false;
    listResumeDeliveries(recordId)
      .then((items) => {
        if (!cancelled) setDeliveries(items);
      })
      .catch(() => {
        // 取不到就不展示投递记录；「独立版本/血缘」的判断不依赖这份请求。
        if (!cancelled) setDeliveries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (deliveries === null) return null;

  return (
    <div className="resume-delivery-info" data-testid="resume-delivery-info">
      <Space size={8} wrap>
        {parentRevisionId !== null && (
          <Typography.Text type="secondary">派生自简历 #{parentRevisionId}</Typography.Text>
        )}
        {deliveries.length === 0 && parentRevisionId === null && (
          <Typography.Text type="secondary">独立版本，暂无投递记录</Typography.Text>
        )}
        {deliveries.map((item) => (
          <Tag key={item.id} color="blue" style={{ marginInlineEnd: 0 }}>
            已投递给 {item.company || "（公司未知）"} · {item.job_title || "（岗位未知）"} ·{" "}
            {DELIVERY_SOURCE_LABELS[item.source] ?? item.source} ·{" "}
            {new Date(item.created_at).toLocaleDateString()} · {item.content_sha256.slice(0, 8)}
          </Tag>
        ))}
      </Space>
    </div>
  );
}
