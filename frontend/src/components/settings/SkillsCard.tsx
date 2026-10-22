// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的助手技能摘要：**只读**。
 *
 * 技能有两个能改的地方时，用户在设置页关掉技能、回工作台发现还开着——这类
 * 「同一份数据两个写入口」的问题比命名不一致严重得多。所以技能的新建 / 导入 /
 * 启用停用 / 删除全部收归工作台（`pages/SkillsPage.tsx`，路由 `/skills`），
 * 这张卡只保留「看一眼现状 + 去工作台改」：
 * 卡片标题、说明段、技能列表（名称 / 状态 / 描述）、点击技能名查看详情（只读）、
 * 以及超过 5 项时的「显示全部」折叠。
 */

import { Button, Card, Listy, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import EmptyState from "../common/EmptyState";
import LoadingBlock from "../common/LoadingBlock";
import type { AssistantSkill } from "../../types";
import { useCollapsedList } from "../common/useCollapsedList";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../common/listyPadding";
import { formatDateTime } from "../../utils/format";

interface Props {
  skills: AssistantSkill[];
  loading: boolean;
  /** 点击技能名查看详情（只读展示提示词全文与知识文件；改要在工作台）。 */
  onOpen: (skill: AssistantSkill) => void;
}

function describe(skill: AssistantSkill): string {
  const files = skill.files.length > 0 ? `${skill.files.length} 份知识文件` : "仅提示词";
  return [
    skill.description || "未填写适用场景",
    files,
    `提示词 ${skill.prompt_chars} 字`,
    `更新于 ${formatDateTime(skill.updated_at)}`,
  ].join(" · ");
}

export default function SkillsCard({ skills, loading, onOpen }: Props) {
  // 技能多了会淹没页面：默认只展示前 5 项，其余收进「显示全部」（展示层折叠）。
  const { visibleItems: visibleSkills, toggleNode: skillsToggleNode } = useCollapsedList(skills);

  return (
    <Card title="助手技能" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        技能是一份<strong>提示词</strong>，也可以再带上一包<strong>知识文件</strong>
        （.md / .txt）。启用的技能会告诉助手「按什么要求作答」，知识文件则由助手在需要时自己去读，
        不会一次性塞进对话。想新建或改得更细，请
        <Link to="/skills">去工作台管理</Link>。
      </Typography.Paragraph>

      {/* List 的 loading 是内容外层的 Spin；空态单独渲染（与原 locale.emptyText 等价）。 */}
      <LoadingBlock spinning={loading}>
        {skills.length === 0 ? (
          <div style={{ marginTop: 16 }}>
            <EmptyState inline description="还没有技能" />
          </div>
        ) : (
          <Listy
            style={{ marginTop: 16 }}
            items={visibleSkills}
            rowKey={(skill) => skill.id}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(skill) => (
              <ListyItem>
                <ListyMeta
                  title={
                    <Space size={8} wrap>
                      {/* 技能名可点击：只读查看提示词全文与知识文件。 */}
                      <Button type="link" className="table-text-link" onClick={() => onOpen(skill)}>
                        {skill.name}
                      </Button>
                      <Tag color={skill.enabled ? "blue" : "default"}>
                        {skill.enabled ? "启用中" : "已停用"}
                      </Tag>
                    </Space>
                  }
                  description={describe(skill)}
                />
              </ListyItem>
            )}
          />
        )}
        {skillsToggleNode}
      </LoadingBlock>
    </Card>
  );
}
