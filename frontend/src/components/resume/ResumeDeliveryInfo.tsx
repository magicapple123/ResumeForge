// SPDX-License-Identifier: Apache-2.0
/**
 * 版本信息位（RF-17 / PR-09 可信交付账本）：一份简历的版本血缘与投递记录。
 *
 * 诚实口径——三种来源语义区分，不把"导出留档/手工关联"说成"已实际投递"：
 * - apply（投递台）：真实的投递动作回写 → 「已投递给」；
 * - track（进度关联）：用户手工把进度关联到这份简历 → 「进度关联」，非直接投递；
 * - export（导出存档）：导出时显式落档 → 「导出存档」，不代表已实际发送。
 *
 * 旧版本快照没有目的地字段（company/job_title 全空）→ 显示「目的地未记录」，
 * 不编造。请求失败显示**错误态**（可重试）而不是「暂无投递记录」——加载不出来
 * 不等于没有记录。数据在弹窗打开时按需拉取；「独立版本/血缘」的判断不依赖它。
 */
import { App, Button, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { downloadDelivery, listResumeDeliveries } from "../../api/resumes";
import type { DeliverySummary } from "../../types";
import { downloadBlob } from "../../utils/download";

const DELIVERY_SOURCE_LABELS: Record<string, MessageKey> = {
  apply: "resumeDeliveryInfo.source.apply",
  track: "resumeDeliveryInfo.source.track",
  export: "resumeDeliveryInfo.source.export",
};

/** 按来源区分语义的前缀文案：只有 apply 是"已实际投递"（ADR-0002 三态语义）。 */
function deliveryPrefix(source: string): MessageKey {
  switch (source) {
    case "apply":
      return "resumeDeliveryInfo.prefix.apply";
    case "track":
      return "resumeDeliveryInfo.prefix.track";
    case "export":
      return "resumeDeliveryInfo.prefix.export";
    default:
      return "resumeDeliveryInfo.prefix.default";
  }
}

/** 按来源区分的后缀说明：明确"这不是投递台发送"的两种情况。 */
function deliverySuffix(source: string): MessageKey | null {
  switch (source) {
    case "track":
      return "resumeDeliveryInfo.suffix.track";
    case "export":
      return "resumeDeliveryInfo.suffix.export";
    default:
      return null;
  }
}

interface Props {
  recordId: number;
  /** 版本血缘（RF-17）：由哪份简历派生而来；null = 独立版本。 */
  parentRevisionId: number | null;
}

export default function ResumeDeliveryInfo({ recordId, parentRevisionId }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [deliveries, setDeliveries] = useState<DeliverySummary[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // 请求失败是**错误态**而不是空态（PR-09）：失败静默降级成「暂无投递记录」
  // 会让用户误以为没投过。显示可重试的错误说明。
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Compiler 规范：随 recordId 变化的重置用渲染期守卫式调整（含首次挂载），
  // 不在 effect 里同步 setState（避免级联渲染，见 ResumeDetailModal 同款处理）。
  const [prevRecordId, setPrevRecordId] = useState(recordId);
  if (prevRecordId !== recordId) {
    setPrevRecordId(recordId);
    setDeliveries(null);
    setLoadFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    listResumeDeliveries(recordId)
      .then((items) => {
        if (cancelled) return;
        setDeliveries(items);
        setLoadFailed(false);
      })
      .catch(() => {
        // 取不到就不展示投递记录明细，但必须如实告诉用户"这是加载失败"。
        if (!cancelled) {
          setDeliveries([]);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, reloadToken]);

  // 下载交付存档：export 快照重放导出、apply/track 返回冻结内容 JSON。重放字节是按
  // 存档重新生成的（HTML 每次换 CSP nonce），与当初下载的那份可能不同——这一点如实
  // 说出来，并提供可核对的两个哈希，而不是含糊地叫「原件」。
  const handleDownload = async (item: DeliverySummary) => {
    if (downloadingId !== null) return;
    setDownloadingId(item.id);
    try {
      const file = await downloadDelivery(item.id);
      downloadBlob(file.blob, file.filename);
      if (file.replayed && file.artifactSha256 && file.artifactSha256 !== file.contentSha256) {
        message.info(
          t("resumeDeliveryInfo.download.replayed", { hash: file.artifactSha256.slice(0, 8) }),
        );
      } else {
        message.success(t("resumeDeliveryInfo.download.success"));
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumeDeliveryInfo.download.failed"));
    } finally {
      setDownloadingId(null);
    }
  };

  if (deliveries === null) return null;

  return (
    <div className="resume-delivery-info" data-testid="resume-delivery-info">
      <Space size={8} wrap>
        {parentRevisionId !== null && (
          <Typography.Text type="secondary">
            {t("resumeDeliveryInfo.parent.derivedFrom", { id: parentRevisionId })}
          </Typography.Text>
        )}
        {deliveries.length === 0 && !loadFailed && parentRevisionId === null && (
          <Typography.Text type="secondary">
            {t("resumeDeliveryInfo.empty.standalone")}
          </Typography.Text>
        )}
        {loadFailed && (
          <Space size={4} wrap>
            <Typography.Text type="warning">
              {t("resumeDeliveryInfo.error.loadFailed")}
            </Typography.Text>
            <Button
              size="small"
              type="link"
              onClick={() => setReloadToken((token) => token + 1)}
              data-testid="delivery-retry"
            >
              {t("common.retry")}
            </Button>
          </Space>
        )}
        {deliveries.map((item) => {
          const destinationMissing = !item.company && !item.job_title;
          const sourceLabelKey = DELIVERY_SOURCE_LABELS[item.source];
          const suffixKey = deliverySuffix(item.source);
          return (
            <Tag key={item.id} color="blue" style={{ marginInlineEnd: 0 }}>
              {t(deliveryPrefix(item.source))}
              {destinationMissing
                ? t("resumeDeliveryInfo.destination.missing")
                : `${item.company || t("resumeDeliveryInfo.destination.companyUnknown")} · ${item.job_title || t("resumeDeliveryInfo.destination.jobUnknown")}`}{" "}
              · {sourceLabelKey ? t(sourceLabelKey) : item.source} ·{" "}
              {new Date(item.created_at).toLocaleDateString()} · {item.content_sha256.slice(0, 8)}
              {suffixKey ? t(suffixKey) : null}
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 4 }}
                loading={downloadingId === item.id}
                onClick={() => void handleDownload(item)}
                data-testid={`delivery-download-${item.id}`}
              >
                {t("resumeDeliveryInfo.download.action")}
              </Button>
            </Tag>
          );
        })}
      </Space>
    </div>
  );
}
