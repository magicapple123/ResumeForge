/** 内推详情抽屉：状态 Tag / 字段清单 / 备注与图片备注分区 / 编辑入口。
 *
 * 纯展示组合——详情数据与编辑回调由 ReferralPanel 传入。
 */
import { Button, Space, Tag } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { REFERRAL_STATUS_COLORS, REFERRAL_STATUS_LABELS, referralImageUrl } from "../../types";
import type { Referral, ReferralStatus } from "../../types";
import { formatDateTime } from "../../utils/format";
import { RecordDetailDrawer } from "../common/RecordDetail";

interface Props {
  detail: Referral | null;
  onEdit: (item: Referral) => void;
  onClose: () => void;
}

export default function ReferralDetailDrawer({ detail, onEdit, onClose }: Props) {
  return (
    <RecordDetailDrawer
      open={detail !== null}
      title={detail?.position || detail?.company || "内推详情"}
      subtitle={detail?.company}
      tags={
        detail && (
          <Space size={6} wrap>
            <Tag color={REFERRAL_STATUS_COLORS[detail.status as ReferralStatus] ?? "default"}>
              {REFERRAL_STATUS_LABELS[detail.status as ReferralStatus] ?? detail.status}
            </Tag>
            {detail.converted && <Tag color="green">已转化</Tag>}
          </Space>
        )
      }
      fields={
        detail
          ? [
              { label: "公司", value: detail.company || "-" },
              { label: "内推岗位", value: detail.position || "-" },
              { label: "内推人", value: detail.referrer_name || "未记录" },
              { label: "联系方式", value: detail.referrer_contact || "-" },
              { label: "关系", value: detail.relation || "-" },
              { label: "渠道", value: detail.channel || "-" },
              { label: "内推码", value: detail.referral_code || "-" },
              { label: "投递日期", value: detail.submitted_at || "未知" },
              { label: "关联岗位", value: detail.job_title || "-" },
              { label: "创建时间", value: formatDateTime(detail.created_at) },
              { label: "更新时间", value: formatDateTime(detail.updated_at) },
            ]
          : []
      }
      sections={
        detail
          ? [
              { title: "备注", content: detail.note || "（无）" },
              {
                title: `图片备注（${(detail.note_images ?? []).length}）`,
                content:
                  (detail.note_images ?? []).length === 0 ? (
                    "（无）"
                  ) : (
                    <Space size={8} wrap>
                      {(detail.note_images ?? []).map((path) => (
                        <a
                          key={path}
                          href={referralImageUrl(path)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={referralImageUrl(path)}
                            alt="备注图"
                            style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 4 }}
                          />
                        </a>
                      ))}
                    </Space>
                  ),
              },
            ]
          : []
      }
      actions={
        detail && (
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => {
              onEdit(detail);
              onClose();
            }}
          >
            编辑
          </Button>
        )
      }
      onClose={onClose}
    />
  );
}
