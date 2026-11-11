// SPDX-License-Identifier: Apache-2.0
/**
 * 队列条目的详情抽屉（自 ApplyQueuePanel 拆出，纯搬迁，行为等价）。
 *
 * 表格里只放得下摘要（岗位 / 准入 / 状态 / 简历名 + 招呼语首行），招呼语全文、准入结论、
 * 排队序号与时间都在这里看。拆出来的原因只有一个：#14 要给面板加体检抽屉、吸底条与
 * 清理入口，面板本身已贴 500 行预算。
 */
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Space, Tag } from "antd";
import { RecordDetailDrawer } from "../../common/RecordDetail";
import { formatDateTime } from "../../../utils/format";
import { QUEUE_STATUS_LABEL_KEYS } from "../../../i18n/enum/apply";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { QUEUE_STATUS_META, type ApplyQueueItem } from "../../../types";
import { AdmissionTag } from "./AdmissionTag";

export function ApplyQueueDetailDrawer({
  item,
  queueItems,
  onClose,
  onEdit,
  onRemove,
}: {
  /** 当前打开的条目；为 null 时抽屉关闭。 */
  item: ApplyQueueItem | null;
  /** 全量队列：排队序号按它算，所以不能用筛选后的列表。 */
  queueItems: readonly ApplyQueueItem[];
  onClose: () => void;
  onEdit: (item: ApplyQueueItem) => void;
  onRemove: (item: ApplyQueueItem) => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后抽屉停在旧文案。
  useLocale();
  return (
    <RecordDetailDrawer
      open={item !== null}
      title={item?.job_title || t("applyQueue.detail.deletedJob")}
      subtitle={item?.company}
      tags={item && <AdmissionTag item={item} />}
      fields={
        item
          ? [
              {
                label: t("applyQueue.detail.autoApply"),
                value:
                  item.apply_supported === false ? (
                    <Tag color="red">{t("applyQueue.detail.unsupported")}</Tag>
                  ) : (
                    t("applyQueue.detail.supported")
                  ),
              },
              {
                label: t("applyQueue.detail.status"),
                value: (
                  <Tag color={QUEUE_STATUS_META[item.status].color}>
                    {t(QUEUE_STATUS_LABEL_KEYS[item.status])}
                  </Tag>
                ),
              },
              {
                label: t("applyQueue.detail.queuePosition"),
                value: t("applyQueue.detail.position", {
                  index: queueItems.findIndex((entry) => entry.id === item.id) + 1,
                }),
              },
              {
                label: t("applyQueue.detail.resume"),
                value: item.resume_title || t("applyQueue.detail.defaultResume"),
              },
              {
                label: t("applyQueue.detail.joinedAt"),
                value: formatDateTime(item.created_at),
              },
              {
                label: t("applyQueue.detail.updatedAt"),
                value: formatDateTime(item.updated_at),
              },
            ]
          : []
      }
      sections={
        item
          ? [
              {
                title: t("applyQueue.detail.greeting"),
                content: item.greeting || t("applyQueue.detail.defaultGreeting"),
              },
            ]
          : []
      }
      actions={
        item && (
          <Space>
            <Button icon={<EditOutlined />} onClick={() => onEdit(item)}>
              {t("applyQueue.action.edit")}
            </Button>
            <Popconfirm
              title={t("applyQueue.confirm.removeTitle")}
              // 后果段与行菜单那一处同措辞：移出队列不动岗位与投递记录。
              description={t("applyQueue.confirm.removeBody")}
              okText={t("applyQueue.action.removeShort")}
              cancelText={t("common.action.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() => onRemove(item)}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t("applyQueue.action.remove")}
              </Button>
            </Popconfirm>
          </Space>
        )
      }
      onClose={onClose}
    />
  );
}
