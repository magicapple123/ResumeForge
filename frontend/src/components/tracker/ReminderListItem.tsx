// SPDX-License-Identifier: Apache-2.0
/** 提醒列表的单条行渲染器：多选勾选行 / 常规行（详情、完成、忽略、「···」菜单、右键菜单）。
 *
 * 从 ReminderPanel 拆出的内聚单元：宿主负责数据与回调，行内交互全部收在这里，
 * 保证两种模式下每条提醒的渲染行为与拆分前完全一致。
 */
import { CheckOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Checkbox, Space, Tag, Typography } from "antd";
import type { Reminder } from "../../types";
import { formatDateTime } from "../../utils/format";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { isFromInnerControl } from "../common/recordDetailCore";
import { RowActions, RowContextMenu } from "../common/RowActions";
import type { RowActionItem } from "../common/RowActions";
import { t } from "../../i18n";
import { reminderKindLabelKey, reminderStatusLabelKey } from "../../i18n/enum/reminder";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  item: Reminder;
  /** 多选模式：行简化为勾选框 + 点行切换，不提供单行操作。 */
  selecting: boolean;
  /** 当前行是否已被勾选。 */
  selected: boolean;
  /** 勾选/取消勾选一条。 */
  onToggle: (id: number) => void;
  /** 打开详情抽屉。 */
  onDetail: (item: Reminder) => void;
  /** 打开编辑弹窗。 */
  onEdit: (item: Reminder) => void;
  /** 删除（宿主内走软删除）。 */
  onRemove: (item: Reminder) => void;
  /** 标记完成 / 忽略。 */
  onStatus: (item: Reminder, status: "done" | "dismissed") => void;
  /** 右键菜单动作（批量选择入口、删除），由宿主构造。 */
  contextActions: (item: Reminder) => RowActionItem[];
}

export default function ReminderListItem({
  item,
  selecting,
  selected,
  onToggle,
  onDetail,
  onEdit,
  onRemove,
  onStatus,
  contextActions,
}: Props) {
  useLocale();
  // 两个 Tag：协议值先映到语言包 key；未知取值回退成后端下发的原值（不丢信息）。
  const kindLabelKey = reminderKindLabelKey(item.kind);
  const statusLabelKey = reminderStatusLabelKey(item.status);
  // 多选模式：行简化为勾选框 + 点行切换，不提供单行操作。
  if (selecting) {
    return (
      <ListyItem
        className="detail-trigger"
        actions={[
          <Checkbox
            key="pick"
            aria-label={t("reminderItem.aria.select", { title: item.title })}
            checked={selected}
            onChange={() => onToggle(item.id)}
          />,
        ]}
        onClick={() => onToggle(item.id)}
      >
        <ListyMeta title={item.title} description={formatDateTime(item.remind_at)} />
      </ListyItem>
    );
  }
  // 「详情」放在第一位：列表只放得下摘要，备注、绑定对象这些都得点进去看。
  const actions = [
    <Button key="detail" type="link" size="small" onClick={() => onDetail(item)}>
      {t("reminderItem.action.detail")}
    </Button>,
  ];
  if (item.status === "pending") {
    actions.push(
      <Button
        key="done"
        type="link"
        size="small"
        icon={<CheckOutlined />}
        aria-label={t("reminderItem.aria.done", { title: item.title })}
        onClick={() => onStatus(item, "done")}
      >
        {t("reminderItem.action.done")}
      </Button>,
    );
    actions.push(
      <Button
        key="dismiss"
        type="text"
        size="small"
        icon={<StopOutlined />}
        aria-label={t("reminderItem.aria.ignore", { title: item.title })}
        onClick={() => onStatus(item, "dismissed")}
      >
        {t("reminderItem.action.ignore")}
      </Button>,
    );
  }
  actions.push(
    // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内（全局约定）。
    <RowActions
      key="more"
      more={[
        {
          key: "edit",
          label: t("reminderItem.action.edit"),
          onClick: () => onEdit(item),
        },
        {
          key: "delete",
          label: t("reminderItem.action.delete"),
          danger: true,
          confirm: t("reminderItem.confirm.delete"),
          confirmBody: t("common.note.trashRecovery"),
          onClick: () => onRemove(item),
        },
      ]}
    />,
  );
  return (
    <RowContextMenu items={contextActions(item)}>
      <ListyItem
        className="detail-trigger"
        actions={actions}
        // 整条点开详情；行内按钮与二次确认不会被这一层抢走。
        onClick={(event) => {
          if (isFromInnerControl(event)) return;
          onDetail(item);
        }}
      >
        <ListyMeta
          title={
            <Space size={6} wrap>
              <span>{item.title}</span>
              <Tag>{kindLabelKey ? t(kindLabelKey) : item.kind}</Tag>
              <Tag
                color={
                  item.status === "pending" ? "blue" : item.status === "done" ? "green" : "default"
                }
              >
                {statusLabelKey ? t(statusLabelKey) : item.status}
              </Tag>
            </Space>
          }
          description={
            <Typography.Text type="secondary">
              {formatDateTime(item.remind_at)}
              {item.note ? ` · ${item.note}` : ""}
            </Typography.Text>
          }
        />
      </ListyItem>
    </RowContextMenu>
  );
}
