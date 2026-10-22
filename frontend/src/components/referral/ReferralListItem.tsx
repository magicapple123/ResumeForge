// SPDX-License-Identifier: Apache-2.0
/** 内推列表的一行：整条点开详情 + 右键「批量选择」+ 更多菜单（编辑 / 删除）。
 *
 * 从 `ReferralPanel` 拆出只为控制文件长度：**渲染结构与交互一个字都没改**，选择态、
 * 菜单构造器与动作回调全部由面板经 props 传入（面板持有 state 与 API 调用）。
 */
import { CheckSquareOutlined, DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Space, Tag, Typography } from "antd";
import { REFERRAL_STATUS_COLORS, REFERRAL_STATUS_LABELS, referralImageUrl } from "../../types";
import type { Referral, ReferralStatus } from "../../types";
import { isFromInnerControl } from "../common/recordDetailCore";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { TRASH_RECOVERY_NOTE, useRowActionMenu } from "../common/rowActionMenu";
import { RowContextMenu } from "../common/RowActions";

interface Props {
  item: Referral;
  /** 多选模式：勾选框替代「详情」按钮，右键菜单收起。 */
  selecting: boolean;
  selected: boolean;
  /** 行菜单构造器由面板的 `useRowActionMenu()` 提供（同一个弹层上下文）。 */
  buildMenu: ReturnType<typeof useRowActionMenu>;
  onToggleSelected: () => void;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEnterSelecting: () => void;
}

export default function ReferralListItem({
  item,
  selecting,
  selected,
  buildMenu,
  onToggleSelected,
  onOpenDetail,
  onEdit,
  onDelete,
  onEnterSelecting,
}: Props) {
  return (
    <ListyItem
      className="detail-trigger"
      // 整条可点开详情；内层的「详情 / 更多」按钮不会被这一层抢走。
      onClick={(event) => {
        if (isFromInnerControl(event)) return;
        onOpenDetail();
      }}
      actions={[
        selecting ? (
          <Checkbox
            key="select"
            aria-label={`选择内推 ${item.referrer_name || item.position}`}
            checked={selected}
            onChange={onToggleSelected}
          />
        ) : (
          <Button key="detail" type="link" size="small" onClick={onOpenDetail}>
            详情
          </Button>
        ),
        ...(selecting
          ? []
          : [
              <Dropdown
                key="more"
                trigger={["click"]}
                menu={{
                  items: buildMenu([
                    {
                      key: "edit",
                      label: "编辑",
                      icon: <EditOutlined />,
                      onClick: onEdit,
                    },
                    {
                      key: "delete",
                      label: "删除",
                      danger: true,
                      icon: <DeleteOutlined />,
                      confirm: "删除这条内推？",
                      confirmBody: TRASH_RECOVERY_NOTE,
                      onClick: onDelete,
                    },
                  ]),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  aria-label={`更多操作 ${item.referrer_name || item.position}`}
                />
              </Dropdown>,
            ]),
      ]}
    >
      {/* 右键菜单挂在条目主体上：多选模式收起（入口只在正常模式的菜单里）。 */}
      <RowContextMenu
        items={
          selecting
            ? []
            : [
                {
                  key: "batch_select",
                  label: "批量选择",
                  icon: <CheckSquareOutlined />,
                  onClick: onEnterSelecting,
                },
              ]
        }
      >
        <div>
          <ListyMeta
            title={
              <Space size={6} wrap>
                <span>
                  {item.referrer_name || "未记内推人"}
                  {item.position ? ` · ${item.position}` : ""}
                </span>
                <Tag color={REFERRAL_STATUS_COLORS[item.status as ReferralStatus] ?? "default"}>
                  {REFERRAL_STATUS_LABELS[item.status as ReferralStatus] ?? item.status}
                </Tag>
                {item.converted && <Tag color="green">已转化</Tag>}
              </Space>
            }
            description={
              <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  {item.company}
                  {item.relation ? ` · ${item.relation}` : ""}
                  {item.channel ? ` · ${item.channel}` : ""}
                </Typography.Text>
                {item.referral_code && (
                  <Typography.Text type="secondary">内推码：{item.referral_code}</Typography.Text>
                )}
                {item.note && <Typography.Text type="secondary">{item.note}</Typography.Text>}
                {(item.note_images ?? []).length > 0 && (
                  <Space size={4} wrap>
                    {(item.note_images ?? []).map((path) => (
                      <img
                        key={path}
                        src={referralImageUrl(path)}
                        alt="备注图"
                        style={{
                          width: 32,
                          height: 32,
                          objectFit: "cover",
                          borderRadius: 3,
                        }}
                      />
                    ))}
                  </Space>
                )}
              </Space>
            }
          />
        </div>
      </RowContextMenu>
    </ListyItem>
  );
}
