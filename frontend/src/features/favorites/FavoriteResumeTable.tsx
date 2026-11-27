// SPDX-License-Identifier: Apache-2.0
/**
 * 收藏页的「简历」表格（T31）：内部简历与外部简历**同屏一行一份**。
 *
 * ## 为什么要单独一个组件
 *
 * 两种 kind 共享一张表，但渲染细节不同（外部行有格式徽标与「外部」标签），全部塞回
 * `FavoritesPage.tsx` 会把它顶过 500 行预算，也让"页面编排"与"行怎么画"混在一处。
 * 这里只做呈现：取数、取消收藏、打开详情都由页面给回调（与 `FavoriteJobsTable`
 * 同一分工）。
 *
 * ## 为什么列表项必须标「内部 / 外部」
 *
 * 两张表的 id 各自从 1 开始、**会撞号**：用户看到两行"第 3 份"时，光凭名字无法判断
 * 点进去会打开哪张表的详情。标签 + 格式徽标一起给出「这是哪一类对象」，
 * 用户才不会在两种详情之间迷路。
 *
 * ## 为什么宽表也不开 `scroll.x`
 *
 * 简历页签的列本来就窄（没有岗位页签那么多状态列）。开 `scroll.x` 会在窄窗里造出
 * 一条用不上的横向滚动条，而空收藏时那个容器里没有任何可聚焦元素（axe 的
 * `scrollable-region-focusable`）。`FavoritesPage.test.tsx` 有用例钉住这一点。
 */
import { StarFilled } from "@ant-design/icons";
import { Button, Space, Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import type { HTMLAttributes, ReactNode } from "react";
import type { FavoriteResumeItem } from "../../api/favorites";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import type { Page } from "../../types";
import { fileKindBadge, fileKindOf } from "../../utils/fileKind";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 当前页数据；`undefined` = 首屏还在加载（表格自带加载态）。 */
  page: Page<FavoriteResumeItem> | undefined;
  loading: boolean;
  /** 正在写库的行 ref（`internal:12`）；非空时整表星星都禁用，避免连点。 */
  busyKey: string;
  pageIndex: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  /** 点标题 / 「打开详情」：内部开详情弹层，外部开原件与历史版本弹层。 */
  onOpen: (item: FavoriteResumeItem) => void;
  /** 「在简历中心打开」：跳到该 kind 的深链（内部 `?resume_id=`、外部 `?resume=`）。 */
  onOpenInHub: (item: FavoriteResumeItem) => void;
  onUnfavorite: (item: FavoriteResumeItem) => void;
  emptyText: ReactNode;
}

/** 行的稳定 key：`internal:12` / `external:7`（两张表 id 撞号，不能只用 id）。 */
function rowKeyOf(item: FavoriteResumeItem): string {
  return item.ref || `${item.kind}:${item.id}`;
}

/** 格式徽标文字：外部简历按 MIME + 文件名判定；内部简历没有"格式"这一档。 */
function formatBadge(item: FavoriteResumeItem): string | null {
  if (item.kind !== "external") return null;
  return fileKindBadge(fileKindOf(item.mime, item.title));
}

export default function FavoriteResumeTable({
  page,
  loading,
  busyKey,
  pageIndex,
  pageSize,
  onPageChange,
  onOpen,
  onOpenInHub,
  onUnfavorite,
  emptyText,
}: Props) {
  useLocale();
  const items = page?.items ?? [];

  /** 每行的「⋯」与右键菜单：打开详情 + 在简历中心打开 + 取消收藏。 */
  const rowActions = (item: FavoriteResumeItem): RowActionItem[] => [
    {
      key: "open",
      label: t("favorites.action.openResume"),
      onClick: () => onOpen(item),
    },
    {
      // 深链口径沿用既有约定（内部 `?resume_id=` 已被简历中心消费；外部 `?resume=`
      // 是 T13「提醒→关联简历」在用的路径），**不新造路由**。
      key: "hub",
      label: t("favorites.action.openInHub"),
      onClick: () => onOpenInHub(item),
    },
    {
      key: "unfavorite",
      label: t("favorites.action.unfavorite"),
      onClick: () => onUnfavorite(item),
    },
  ];

  const columns: TableColumnsType<FavoriteResumeItem> = [
    {
      title: t("favorites.column.resume"),
      dataIndex: "title",
      render: (_, item) => (
        <Space size={6}>
          {/* 标题本身可点：与简历中心"点名字看详情"一致，用户不必先找「⋯」。 */}
          <Button type="link" className="table-text-link" onClick={() => onOpen(item)}>
            {item.title}
          </Button>
        </Space>
      ),
    },
    {
      title: t("favorites.column.kind"),
      dataIndex: "kind",
      width: 104,
      render: (_, item) => (
        <Tag color={item.kind === "external" ? "gold" : "blue"}>
          {item.kind === "external" ? t("favorites.kind.external") : t("favorites.kind.internal")}
        </Tag>
      ),
    },
    {
      title: t("favorites.column.targetJob"),
      width: 220,
      render: (_, item) => {
        // 通用简历（没有关联岗位）不画空标签：一个只有破折号的蓝框看起来像"加载失败"。
        if (!item.job_title && !item.company) {
          return <span style={{ color: "var(--rf-text-secondary)" }}>—</span>;
        }
        return (
          <Space size={4} wrap>
            {item.job_title && <Tag color="blue">{item.job_title}</Tag>}
            {item.company && <Tag>{item.company}</Tag>}
          </Space>
        );
      },
    },
    {
      title: t("favorites.column.format"),
      dataIndex: "mime",
      width: 96,
      render: (_, item) => {
        const badge = formatBadge(item);
        // 内部简历没有"格式"：用破折号表示不适用，而不是编一个假徽标。
        if (!badge) return <span style={{ color: "var(--rf-text-secondary)" }}>—</span>;
        return <Tag>{badge}</Tag>;
      },
    },
    {
      title: t("favorites.column.favoritedAt"),
      dataIndex: "favorited_at",
      width: 210,
      render: (_, item) =>
        item.favorited_at ? (
          <Space size={4} wrap={false}>
            <span>{formatDateTime(item.favorited_at)}</span>
            {item.favorited_at_estimated && (
              <Tag color="orange">{t("favorites.badge.estimated")}</Tag>
            )}
          </Space>
        ) : (
          <Tag color="orange">{t("favorites.badge.estimated")}</Tag>
        ),
    },
    {
      title: t("favorites.column.actions"),
      width: 130,
      align: "center",
      render: (_, item) => {
        const key = rowKeyOf(item);
        return (
          <Space size={4}>
            <Tooltip title={t("favorites.action.unfavorite")}>
              <Button
                type="text"
                aria-label={t("favorites.action.unfavorite")}
                loading={busyKey === key}
                disabled={Boolean(busyKey)}
                icon={<StarFilled style={{ color: "var(--rf-favorite)" }} />}
                onClick={() => onUnfavorite(item)}
              />
            </Tooltip>
            <RowActions more={rowActions(item)} />
          </Space>
        );
      },
    },
  ];

  return (
    <Table<FavoriteResumeItem>
      rowKey={rowKeyOf}
      columns={columns}
      dataSource={items}
      loading={loading}
      locale={{ emptyText }}
      components={{
        body: {
          row: (props: HTMLAttributes<HTMLTableRowElement>) => {
            const key = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
            const item = items.find((entry) => rowKeyOf(entry) === key);
            if (!item) return <tr {...props} />;
            return (
              <RowContextMenu items={rowActions(item)}>
                <tr {...props} />
              </RowContextMenu>
            );
          },
        },
      }}
      pagination={{
        current: pageIndex,
        pageSize,
        total: page?.total ?? 0,
        showSizeChanger: true,
        showTotal: (total) => t("favorites.pagination.total", { total }),
        onChange: onPageChange,
      }}
    />
  );
}
