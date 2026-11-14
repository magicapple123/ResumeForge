// SPDX-License-Identifier: Apache-2.0
/** 内推详情抽屉：状态 Tag / 字段清单 / 备注与图片备注分区 / 编辑入口。
 *
 * 纯展示组合——详情数据与编辑回调由 ReferralPanel 传入。
 */
import { Button, Image, Space, Tag } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { REFERRAL_STATUS_COLORS, referralImageUrl } from "../../types";
import type { Referral, ReferralStatus } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { referralStatusLabelKey } from "../../i18n/enum/referral";
import { useLocale } from "../../i18n/i18nContext";
import { RecordDetailDrawer } from "../../components/common/RecordDetail";

interface Props {
  detail: Referral | null;
  onEdit: (item: Referral) => void;
  onClose: () => void;
}

export default function ReferralDetailDrawer({ detail, onEdit, onClose }: Props) {
  // 本文件用模块级 t()：必须订阅语言变化，否则切语言后抽屉文案不重渲染。
  useLocale();
  // 状态 Tag：协议值先映到语言包 key；未知取值回退成后端下发的原值（不丢信息）。
  const statusLabelKey = detail ? referralStatusLabelKey(detail.status) : undefined;
  return (
    <RecordDetailDrawer
      open={detail !== null}
      title={detail?.position || detail?.company || t("referralDetail.title.fallback")}
      subtitle={detail?.company}
      tags={
        detail && (
          <Space size={6} wrap>
            <Tag color={REFERRAL_STATUS_COLORS[detail.status as ReferralStatus] ?? "default"}>
              {statusLabelKey ? t(statusLabelKey) : detail.status}
            </Tag>
            {detail.converted && <Tag color="green">{t("referralDetail.tag.converted")}</Tag>}
          </Space>
        )
      }
      fields={
        detail
          ? [
              // 空值传 undefined 而不是 "-"：组件按"空白即不存在"整行不渲染，
              // 假占位会让一条只填了公司名的内推看起来填满了。
              { label: t("referralDetail.field.company"), value: detail.company || undefined },
              { label: t("referralDetail.field.position"), value: detail.position || undefined },
              {
                label: t("referralDetail.field.referrer"),
                value: detail.referrer_name || t("referralDetail.value.notRecorded"),
              },
              {
                label: t("referralDetail.field.contact"),
                value: detail.referrer_contact || undefined,
              },
              { label: t("referralDetail.field.relation"), value: detail.relation || undefined },
              { label: t("referralDetail.field.channel"), value: detail.channel || undefined },
              {
                label: t("referralDetail.field.code"),
                value: detail.referral_code || undefined,
              },
              {
                label: t("referralDetail.field.submittedAt"),
                value: detail.submitted_at || t("referralDetail.value.unknown"),
              },
              { label: t("referralDetail.field.job"), value: detail.job_title || undefined },
              {
                label: t("referralDetail.field.createdAt"),
                value: formatDateTime(detail.created_at),
              },
              {
                label: t("referralDetail.field.updatedAt"),
                value: formatDateTime(detail.updated_at),
              },
            ]
          : []
      }
      sections={
        detail
          ? [
              // 备注与图片备注都为空时整块不出现：标签里已经写了「图片备注（0）」，
              // 再补一句「（无）」只是把同一件事说两遍。
              ...(detail.note
                ? [{ title: t("referralDetail.section.note"), content: detail.note }]
                : []),
              ...((detail.note_images ?? []).length > 0
                ? [
                    {
                      title: t("referralDetail.section.images", {
                        count: (detail.note_images ?? []).length,
                      }),
                      content: (
                        <Space size={8} wrap>
                          {/* 用 antd Image 的原生预览（遮罩层里的那张大图），不用 `<a target="_blank">`：
                              后者会把用户甩到一个新页面，和岗位备注、资料附件、我的文件里的
                              图片预览都不一致（用户截图反馈"不要新进一个页面"）。 */}
                          {(detail.note_images ?? []).map((path, index) => (
                            <Image
                              key={path}
                              src={referralImageUrl(path)}
                              alt={t("referralDetail.image.noteAlt")}
                              width={96}
                              height={96}
                              style={{ objectFit: "cover", borderRadius: 4 }}
                              preview={{
                                mask: t("referralDetail.image.previewMask", { index: index + 1 }),
                              }}
                            />
                          ))}
                        </Space>
                      ),
                    },
                  ]
                : []),
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
            {t("referralDetail.action.edit")}
          </Button>
        )
      }
      onClose={onClose}
    />
  );
}
