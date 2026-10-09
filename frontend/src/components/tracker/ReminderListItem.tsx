/** 提醒列表的单条行渲染器：多选勾选行 / 常规行（详情、完成、忽略、「···」菜单、右键菜单）。
 *
 * 从 ReminderPanel 拆出的内聚单元：宿主负责数据与回调，行内交互全部收在这里，
 * 保证两种模式下每条提醒的渲染行为与拆分前完全一致。
 */
import { CheckOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Checkbox, Space, Tag, Typography } from "antd";
import type { Reminder, ReminderKind, ReminderStatus } from "../../types";
import { REMINDER_KIND_LABELS, REMINDER_STATUS_LABELS } from "../../types";
import { formatDateTime } from "../../utils/format";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { isFromInnerControl } from "../common/recordDetailCore";
import { RowActions, RowContextMenu } from "../common/RowActions";
import type { RowActionItem } from "../common/RowActions";

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
  // 多选模式：行简化为勾选框 + 点行切换，不提供单行操作。
  if (selecting) {
    return (
      <ListyItem
        className="detail-trigger"
        actions={[
          <Checkbox
            key="pick"
            aria-label={`选择提醒 ${item.title}`}
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
      详情
    </Button>,
  ];
  if (item.status === "pending") {
    actions.push(
      <Button
        key="done"
        type="link"
        size="small"
        icon={<CheckOutlined />}
        aria-label={`完成提醒 ${item.title}`}
        onClick={() => onStatus(item, "done")}
      >
        完成
      </Button>,
    );
    actions.push(
      <Button
        key="dismiss"
        type="text"
        size="small"
        icon={<StopOutlined />}
        aria-label={`忽略提醒 ${item.title}`}
        onClick={() => onStatus(item, "dismissed")}
      >
        忽略
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
          label: "编辑",
          onClick: () => onEdit(item),
        },
        {
          key: "delete",
          label: "删除",
          danger: true,
          confirm: "删除这条提醒？删除后可在回收站里找回，不会立刻彻底删除。",
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
              <Tag>{REMINDER_KIND_LABELS[item.kind as ReminderKind] ?? item.kind}</Tag>
              <Tag
                color={
                  item.status === "pending" ? "blue" : item.status === "done" ? "green" : "default"
                }
              >
                {REMINDER_STATUS_LABELS[item.status as ReminderStatus] ?? item.status}
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
