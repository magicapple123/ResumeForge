// SPDX-License-Identifier: Apache-2.0
/** 面经列表的单行渲染（从 InterviewExperiencePanel 拆出，压 500 行预算）。
 *
 * 只负责一行的外观与行内交互：来源/轮次标签、问题预览、批量选择勾选框、
 * 「详情 / 更多」动作与整行右键菜单。数据拉取与增删改仍由面板本体负责。
 */
import { CheckSquareOutlined, DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Space, Tag, Typography } from "antd";
import { RowContextMenu } from "../../components/common/RowActions";
import { isFromInnerControl } from "../../components/common/recordDetailCore";
import { ListyItem, ListyMeta } from "../../components/common/ListyItem";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import { experienceRoundTypeLabelKey, experienceSourceLabelKey } from "../../i18n/enum/interview";
import type { InterviewExperience } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface InterviewExperienceListItemProps {
  item: InterviewExperience;
  /** 批量选择模式：行动作区换成勾选框。 */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** 右键菜单里的「批量选择」入口。 */
  onEnterSelecting: () => void;
  onOpenDetail: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

export default function InterviewExperienceListItem({
  item,
  selecting,
  selected,
  onToggleSelect,
  onEnterSelecting,
  onOpenDetail,
  onEdit,
  onRemove,
}: InterviewExperienceListItemProps) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const buildMenu = useRowActionMenu();
  // 来源/轮次是协议值：显示名走语言包；白名单外的历史值原样显示。
  const sourceKey = experienceSourceLabelKey(item.source);
  const roundKey = experienceRoundTypeLabelKey(item.round_type);
  return (
    <ListyItem
      className="detail-trigger"
      // 整条点开详情；行内的「详情 / 更多」按钮不会被这一层抢走。
      onClick={(event) => {
        if (isFromInnerControl(event)) return;
        onOpenDetail();
      }}
      actions={[
        selecting ? (
          <Checkbox
            key="select"
            aria-label={t("interviewExperience.aria.select", {
              name: item.title || item.company,
            })}
            checked={selected}
            onChange={onToggleSelect}
          />
        ) : (
          <Button key="detail" type="link" size="small" onClick={onOpenDetail}>
            {t("interviewExperience.action.detail")}
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
                      label: t("interviewExperience.action.edit"),
                      icon: <EditOutlined />,
                      onClick: onEdit,
                    },
                    {
                      key: "delete",
                      label: t("common.action.delete"),
                      danger: true,
                      icon: <DeleteOutlined />,
                      confirm: t("interviewExperience.confirm.delete"),
                      confirmBody: t("common.note.trashRecovery"),
                      onClick: onRemove,
                    },
                  ]),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  aria-label={t("interviewExperience.aria.more", {
                    name: item.title || item.company,
                  })}
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
                  label: t("common.action.batchSelect"),
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
                <span>{item.title || t("interviewExperience.untitled")}</span>
                <Tag color="geekblue">{sourceKey ? t(sourceKey) : item.source}</Tag>
                {item.round_type && <Tag>{roundKey ? t(roundKey) : item.round_type}</Tag>}
                {item.interview_date && <Tag>{item.interview_date}</Tag>}
              </Space>
            }
            description={
              <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  {item.company}
                  {item.position ? ` · ${item.position}` : ""}
                  {item.difficulty ? ` · ${item.difficulty}` : ""}
                </Typography.Text>
                {item.questions.length > 0 && (
                  <Typography.Text type="secondary">
                    {t("interviewExperience.questions.preview", {
                      count: item.questions.length,
                    })}
                    {item.questions.slice(0, 3).join(t("interviewExperience.separator.question"))}
                  </Typography.Text>
                )}
                {item.tags.length > 0 && (
                  <Space size={4} wrap>
                    {item.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
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
