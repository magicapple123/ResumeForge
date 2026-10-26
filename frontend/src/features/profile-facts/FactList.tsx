// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实列表：按九类分组折叠，组内保持服务端 `sort_order` 原序。
 *
 * 排序口径：分组顺序是固定的九类顺序（契约 §1），但**组内绝不重排**——用户先前
 * 保存的顺序（随后端返回）原样展示，不按标题/时间二次排序。
 *
 * 每行显示标题、副标题（含自定义字段值）、状态徽标与「编辑 / 删除」；被字段设置隐藏
 * 的默认字段不展示（契约 §3），已删除定义的自定义字段值也不再展示（契约 §2）。
 * 删除是软删（移入回收站），由调用方执行后给结果提示。
 */
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Collapse, Listy, Space, Tag, Tooltip, Typography } from "antd";
import { useMemo } from "react";
import { ListyItem, ListyMeta } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { FACT_KINDS, FACT_KIND_LABEL_KEYS } from "./constants";
import { factBadge, factCustomLines, factSecondary, factTitle } from "./factDisplay";
import type { FactCustomFieldDef, FactKind, ProfileFact } from "./types";

interface RowProps {
  fact: ProfileFact;
  hiddenFields: readonly string[];
  customFieldDefs: readonly FactCustomFieldDef[];
  onEdit: (fact: ProfileFact) => void;
  onDelete: (fact: ProfileFact) => void;
}

function FactRow({ fact, hiddenFields, customFieldDefs, onEdit, onDelete }: RowProps) {
  useLocale();
  const label = t(FACT_KIND_LABEL_KEYS[fact.kind]);
  const title = factTitle(fact, hiddenFields) || t("profileFacts.list.untitled");
  const secondary = factSecondary(fact, hiddenFields);
  const customLines = factCustomLines(fact, customFieldDefs);
  const description = [secondary, ...customLines].filter(Boolean).join(" · ");
  const badge = factBadge(fact, hiddenFields);
  const editLabel = t("profileFacts.list.editAria", { label, title });
  const deleteLabel = t("profileFacts.list.deleteAria", { label, title });
  return (
    <ListyItem
      className="profile-facts-row"
      // 两个图标按钮包一层：ListyItem 内部动作区是 4px 间距，行尾按钮要求 8px。
      actions={[
        <span key="actions" className="profile-facts-row-actions">
          <Tooltip title={editLabel}>
            <Button
              type="text"
              size="small"
              aria-label={editLabel}
              icon={<EditOutlined />}
              onClick={() => onEdit(fact)}
            />
          </Tooltip>
          <Tooltip title={t("profileFacts.list.deleteTooltip", { label })}>
            <Button
              type="text"
              size="small"
              danger
              aria-label={deleteLabel}
              icon={<DeleteOutlined />}
              onClick={() => onDelete(fact)}
            />
          </Tooltip>
        </span>,
      ]}
    >
      <ListyMeta
        title={
          <span className="profile-facts-row-title">
            <span className="profile-facts-row-name">{title}</span>
            {badge ? (
              <Tag color={badge.color} variant="filled">
                {badge.labelKey ? t(badge.labelKey) : badge.text}
              </Tag>
            ) : null}
          </span>
        }
        description={
          description ? (
            <span className="profile-facts-row-secondary">{description}</span>
          ) : undefined
        }
      />
    </ListyItem>
  );
}

interface Props {
  facts: ProfileFact[];
  /** 服务端总数：大于当前条数时给「加载更多」。 */
  total: number;
  loadingMore: boolean;
  /** 每种类型被字段设置隐藏的默认字段（界面不展示）。 */
  hiddenFieldsByKind: Record<FactKind, readonly string[]>;
  /** 每种类型当前的自定义字段定义（只展示这些字段的值）。 */
  customFieldDefsByKind: Record<FactKind, readonly FactCustomFieldDef[]>;
  onEdit: (fact: ProfileFact) => void;
  onDelete: (fact: ProfileFact) => void;
  onLoadMore: () => void;
}

export default function FactList({
  facts,
  total,
  loadingMore,
  hiddenFieldsByKind,
  customFieldDefsByKind,
  onEdit,
  onDelete,
  onLoadMore,
}: Props) {
  useLocale();
  const groups = useMemo(
    () =>
      FACT_KINDS.map((kind) => ({
        kind,
        items: facts.filter((fact) => fact.kind === kind),
      })).filter((group) => group.items.length > 0),
    [facts],
  );
  const truncated = total > facts.length;

  return (
    <>
      <Collapse
        size="small"
        className="profile-facts-groups"
        defaultActiveKey={[...FACT_KINDS]}
        items={groups.map((group) => ({
          key: group.kind,
          label: (
            <span className="profile-facts-group-label">
              <span className="profile-facts-group-name">
                {t(FACT_KIND_LABEL_KEYS[group.kind])}
              </span>
              <Tag className="profile-facts-group-count">{group.items.length}</Tag>
            </span>
          ),
          children: (
            <Listy
              items={group.items}
              rowKey={(item) => item.fact_id}
              styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
              itemRender={(fact) => (
                <FactRow
                  fact={fact}
                  hiddenFields={hiddenFieldsByKind[fact.kind] ?? []}
                  customFieldDefs={customFieldDefsByKind[fact.kind] ?? []}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              )}
            />
          ),
        }))}
      />
      {truncated ? (
        <Space style={{ marginTop: 8 }} wrap>
          <Typography.Text type="secondary">
            {t("profileFacts.section.limitHint", { total, shown: facts.length })}
          </Typography.Text>
          <Button size="small" loading={loadingMore} onClick={onLoadMore}>
            {t("profileFacts.list.loadMore")}
          </Button>
        </Space>
      ) : null}
    </>
  );
}
