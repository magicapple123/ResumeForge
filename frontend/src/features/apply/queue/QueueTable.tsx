// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列表格：定宽列 + 行选择 + 右键菜单 + 参考分排序。
 * （自 ApplyQueuePanel 拆出：columns/rowSelection/<Table>/右键菜单三段整体搬，
 * contextMenu state 随唯一消费者下沉进本组件；rowMenuItems 经 prop 传入；
 * aria-label/类名/定宽注释逐字随迁，行为等价。）
 *
 * #14B/#14H 的三处改动都在本组件：
 * - 新增 96px「参考分」列：它是**派生值、不参与准入**，列头 tooltip 原样展示后端的
 *   免责文案，`<60` 灰 / `60–79` 蓝 / `≥80` 绿，未分析不渲染成 0 分；
 * - 列头点击在「参考分 / 入队时间」两个排序口径之间切换（前端排序，队列封顶 500）；
 * - 资产列 260→240：简历名收进 Tag、招呼语只放首行，全文走 Tooltip，腾出的宽度给参考分列。
 *
 * 状态标签的展示名走语言包（`QUEUE_STATUS_LABEL_KEYS`），颜色仍取 `QUEUE_STATUS_META`；
 * 列头、空值兜底、提示与 aria-label 走 applyQueue 包。
 *
 * #15A：岗位名那一行的 `<Space wrap>` 末尾挂 `GhostBadge`（「僵尸 82」+ 证据 + 忽略）。
 * 徽标的显隐条件全部在组件内部（`ghost_score == null` / `ghost_ignored` 都不渲染），
 * 这里不写第二份判断；它只是「岗位」列的第二个标签，**没有**新增列，列宽与 `scroll.x`
 * 仍是 900（220+96+140+96+240+108）。
 */
import { FileSearchOutlined, MoreOutlined, StarFilled } from "@ant-design/icons";
import { Badge, Button, Dropdown, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { BadgeProps, TableColumnsType } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react";
import { t } from "../../../i18n";
import { QUEUE_STATUS_LABEL_KEYS } from "../../../i18n/enum/apply";
import { useLocale } from "../../../i18n/i18nContext";
import { useContextMenu } from "../../context-menu/contextMenuContext";
import {
  useRowActionMenu,
  useRowActionRunner,
  type RowMenuItem,
} from "../../../components/common/rowActionMenu";
import type { ApplyQueueItem } from "../../../types";
import { QUEUE_STATUS_META } from "../../../types";
import { formatDateTime } from "../../../utils/format";
import { AdmissionTag } from "./AdmissionTag";
import GhostBadge from "../insights/GhostBadge";
import { firstLine, nextSortKey, scoreBand, sortQueueItems, type QueueSortKey } from "./queueSort";
import "../applyQueueTable.css";

export function QueueTable({
  items,
  busy,
  selectedIds,
  setSelectedIds,
  setDetail,
  rowMenuItems,
  onInspect,
}: {
  items: ApplyQueueItem[];
  busy: boolean;
  selectedIds: number[];
  setSelectedIds: (ids: number[]) => void;
  setDetail: (item: ApplyQueueItem) => void;
  rowMenuItems: (record: ApplyQueueItem) => RowMenuItem[];
  /** #15C 行内「体检」：由面板打开岗位体检小卡片（抽屉），本组件只管回调。 */
  onInspect: (item: ApplyQueueItem) => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后列头停在旧文案。
  useLocale();
  const buildMenu = useRowActionMenu();
  const run = useRowActionRunner();
  /** 右键菜单走全局单实例浮层（问题 25）：贴鼠标、夹进视口、层级取 `layer.aiPolish`。 */
  const contextMenu = useContextMenu();
  /** 排序口径：默认沿用后端顺序（= 入队顺序），点参考分列头才切换。 */
  const [sortKey, setSortKey] = useState<QueueSortKey>("joined");
  const rows = useMemo(() => sortQueueItems(items, sortKey), [items, sortKey]);
  const initialPageSize = typeof window !== "undefined" && window.innerHeight >= 900 ? 20 : 10;

  /**
   * 打开某一行的右键菜单：菜单项与「···」下拉同源，二次确认也走同一套（`run`）。
   * `source` 决定首项是否聚焦——键盘打开才聚焦第一个可用项。
   */
  const openRowMenu = (
    record: ApplyQueueItem,
    point: { x: number; y: number },
    source: "pointer" | "keyboard",
  ) => {
    contextMenu.open({
      x: point.x,
      y: point.y,
      source,
      ariaLabel: t("applyQueue.table.moreActionsAria", { job: record.job_title }),
      items: rowMenuItems(record).map((item) =>
        item.type === "divider" ? item : { ...item, onClick: run(item) },
      ),
    });
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>, record: ApplyQueueItem) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    // 键盘没有指针落点：用行右下角兜底（与指针打开的落位方向一致）。
    openRowMenu(record, { x: rect.right, y: rect.bottom }, "keyboard");
  };

  /**
   * 列宽全部写死、`tableLayout="fixed"`：
   * 招呼语是用户可编辑的长文本，之前不设宽度时它会跟「准入 / 状态」抢空间——编辑过一条
   * 队列条目之后整张表就挤成一团。定宽 + 省略号让每列宽度只由表头决定，内容长短不再影响排版。
   */
  const columns: TableColumnsType<ApplyQueueItem> = [
    {
      title: t("applyQueue.column.job"),
      dataIndex: "job_title",
      width: 300,
      render: (title: string, item) => (
        // 外层 Tooltip 只包**岗位标题按钮**，不再包整个单元格：单元格里的「来源不支持」
        // 标签有自己的提示，两层 Tooltip 叠在同一个触发区上会同时弹出两句
        // （2026-10-25 用户截图：鼠标悬停时提示叠在一起）。
        <Space orientation="vertical" size={0} style={{ width: "100%" }}>
          <Tooltip
            title={t("applyQueue.table.joinedAt", { time: formatDateTime(item.created_at) })}
          >
            <Button
              type="link"
              className="table-text-link"
              onClick={() => setDetail(item)}
              aria-label={t("applyQueue.table.viewDetailAria", {
                title: title || t("applyQueue.table.deletedJobShort"),
              })}
            >
              {title || t("applyQueue.detail.deletedJob")}
            </Button>
          </Tooltip>
          <Space size={4} wrap>
            {item.company && (
              <Typography.Text type="secondary" ellipsis>
                {item.company}
              </Typography.Text>
            )}
            {item.favorite && (
              // #14B 收藏标记：和岗位名同一行，扫一眼就知道"这条是我特意留的"。
              <Tooltip title={t("applyQueue.table.favorite")}>
                <StarFilled
                  className="apply-queue-favorite"
                  aria-label={t("applyQueue.table.favorite")}
                />
              </Tooltip>
            )}
            {item.apply_supported === false && (
              // 和岗位广场上的「采集 / 手动」同一个位置放来源类标签：用户看来源就看这里。
              // 2026-11-13：红实底 -> 灰描边。每行一个红块是这张表最吵的地方，而"来源不支持"
              // 是既定事实、不是需要立刻处理的告警（真要处理有右上那个 chip）。
              <Tooltip title={t("applyQueue.table.unsupportedHint")}>
                <Tag className="apply-queue-unsupported">
                  {t("applyQueue.table.unsupportedTag")}
                </Tag>
              </Tooltip>
            )}
            {/* #15A 僵尸岗雷达：只有后端给了分且用户没忽略过才出现（组件自己判空，
                所以这里不写条件——条件写两处早晚会漂移）。点开是证据 + 「忽略此岗位」。 */}
            <GhostBadge
              queueId={item.id}
              score={item.ghost_score}
              evidence={item.ghost_evidence}
              ignored={item.ghost_ignored}
            />
          </Space>
        </Space>
      ),
    },
    {
      // 「匹配」= 参考分 + 准入（2026-11-13 合并）。两个窄列（96 / 140）里各只有一行字，
      // 横向空掉一半，而岗位列与投递材料列被挤到换行；合成一列后分数在上、准入在下，
      // 省出的 ~104px 还给内容列。列头仍是排序开关，tooltip 是后端要求原样展示的免责文案。
      title: (
        <Tooltip title={t("applyQueue.score.disclaimer")}>
          <Button
            type="text"
            size="small"
            className="apply-queue-sort"
            aria-label={t(
              sortKey === "joined"
                ? "applyQueue.score.sortByScore"
                : "applyQueue.score.sortByJoinedAt",
            )}
            onClick={() => setSortKey((current) => nextSortKey(current))}
          >
            {t("applyQueue.column.match")}
            {/* 排序生效时给一个方向标记：仅靠悬浮提示说明不了"现在是按哪一列排的"。 */}
            {sortKey === "score" ? " ↓" : ""}
          </Button>
        </Tooltip>
      ),
      key: "match",
      width: 132,
      render: (_, item) => {
        const band = scoreBand(item.match_score);
        return (
          <div className="apply-queue-match">
            {band === "none" ? (
              // 未分析不显示成 0 分（那会被读成"不匹配"）：一个破折号 + 悬浮说明，
              // 准入那一格会同时给出「未分析」的结论。
              <Tooltip title={t("applyQueue.score.unanalyzed")}>
                <span className="apply-queue-score" data-band="none">
                  —
                </span>
              </Tooltip>
            ) : (
              <span className="apply-queue-score" data-band={band}>
                {item.match_score}
              </span>
            )}
            <AdmissionTag item={item} variant="inline" />
          </div>
        );
      },
    },
    {
      title: t("applyQueue.column.status"),
      dataIndex: "status",
      width: 104,
      render: (value: ApplyQueueItem["status"]) => (
        // 状态用「圆点 + 文字」而不是色块标签：它只是"能不能投"的前提，
        // 每行一个实底色块会把视线从岗位名上拽走。色仍取 `QUEUE_STATUS_META`，不另立一套。
        <Badge
          status={QUEUE_STATUS_META[value].color as BadgeProps["status"]}
          text={<span className="apply-queue-status">{t(QUEUE_STATUS_LABEL_KEYS[value])}</span>}
        />
      ),
    },
    {
      title: t("applyQueue.column.assets"),
      key: "assets",
      width: 300,
      render: (_, item) => {
        const greeting = item.greeting || t("applyQueue.detail.defaultGreeting");
        return (
          // 一行：简历名收成中性小标签，招呼语跟在后面单行省略。
          // 原先上下两行、简历名还是蓝色实底，整列视觉重量比岗位列还高。
          <div className="apply-queue-assets">
            <Tag className="apply-queue-resume-tag">
              {item.resume_title || t("applyQueue.detail.defaultResume")}
            </Tag>
            {/* 招呼语只放首行：全文在 Tooltip 里（表格是扫视用的，不是阅读区）。 */}
            <Tooltip title={greeting}>
              <Typography.Text type="secondary" ellipsis className="apply-queue-greeting">
                {firstLine(greeting)}
              </Typography.Text>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: t("applyQueue.column.actions"),
      key: "actions",
      // 2026-11-13：两枚描边小方块 -> 两枚文字按钮，默认只有「⋯」可见，
      // 「体检」在悬停/聚焦时显形（仍留在 DOM 里，读屏与键盘照样可达）。列宽 108 -> 72。
      width: 72,
      // 表头与单元格一起右对齐：否则「操作」两字靠左、按钮靠右，看起来像没对齐（用户反馈过）。
      align: "right",
      render: (_, item) => (
        <div
          className="apply-queue-actions"
          style={{ display: "flex", justifyContent: "flex-end", marginLeft: "auto" }}
        >
          {/* #15C 体检：只读、随时可点，结果在抽屉里（行内不展开，避免把行高撑开）。 */}
          <Tooltip title={t("applyQueue.insights.inspect.action")}>
            <Button
              type="text"
              size="small"
              className="apply-queue-row-action"
              aria-label={t("applyQueue.insights.inspect.action")}
              icon={<FileSearchOutlined />}
              onClick={() => onInspect(item)}
            />
          </Tooltip>
          <Dropdown trigger={["click"]} menu={{ items: buildMenu(rowMenuItems(item)) }}>
            <Button
              type="text"
              size="small"
              className="apply-queue-row-action is-always"
              aria-label={t("applyQueue.table.moreActionsAria", { job: item.job_title })}
              icon={<MoreOutlined />}
            />
          </Dropdown>
        </div>
      ),
    },
  ];

  const rowSelection: TableRowSelection<ApplyQueueItem> = {
    selectedRowKeys: selectedIds,
    onChange: (keys) => setSelectedIds(keys.map(Number)),
    getCheckboxProps: (item) => ({
      // 来源不支持的条目**不可勾选**：勾了也投不出去，不如一开始就不让选（后端还会再拦一次）。
      disabled:
        item.status !== "pending" || item.job_id === null || item.apply_supported === false || busy,
    }),
  };

  return (
    <>
      <Table<ApplyQueueItem>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        // 高视口首屏展示更多队列条目；条数切换仍由 Table 内部状态管理。
        pagination={{
          defaultPageSize: initialPageSize,
          hideOnSinglePage: true,
          showSizeChanger: true,
          showTotal: (total) => t("applyQueue.table.total", { total }),
        }}
        rowSelection={rowSelection}
        tableLayout="fixed"
        // 空表时不启用横向滚动（与 `JobTable` 同一口径）：否则 `.ant-table-content` 会变成
        // "可横滚、区域内却没有任何可聚焦元素"的容器，命中 axe 的
        // `scrollable-region-focusable`（serious）。有数据时照旧按列宽固定横滚。
        // `scroll.x` 与列宽之和保持一致（300+132+104+300+72 = 908）。
        scroll={items.length ? { x: 908 } : undefined}
        onRow={(record) => ({
          // 行本身可聚焦：键盘用户要能按 Shift+F10 / 菜单键打开这一行的操作菜单。
          tabIndex: 0,
          onKeyDown: (event) => handleRowKeyDown(event, record),
          onContextMenu: (event) => {
            event.preventDefault();
            openRowMenu(record, { x: event.clientX, y: event.clientY }, "pointer");
          },
        })}
      />
    </>
  );
}
