// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列表格：定宽列 + 行选择 + 右键菜单。
 * （自 ApplyQueuePanel 拆出：columns/rowSelection/<Table>/右键菜单三段整体搬，
 * contextMenu state 随唯一消费者下沉进本组件；rowMenuItems 经 prop 传入；
 * aria-label/类名/定宽注释逐字随迁，行为等价。）
 *
 * 状态标签的展示名走语言包（`QUEUE_STATUS_LABEL_KEYS`），颜色仍取 `QUEUE_STATUS_META`；
 * 列头、空值兜底、提示与 aria-label 走 applyQueue 包。
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "../../../i18n";
import { QUEUE_STATUS_LABEL_KEYS } from "../../../i18n/enum/apply";
import { useLocale } from "../../../i18n/i18nContext";
import { useContextMenu } from "../../../features/context-menu/contextMenuContext";
import { useRowActionMenu, useRowActionRunner, type RowMenuItem } from "../../common/rowActionMenu";
import type { ApplyQueueItem } from "../../../types";
import { QUEUE_STATUS_META } from "../../../types";
import { formatDateTime } from "../../../utils/format";
import { AdmissionTag } from "./AdmissionTag";

export function QueueTable({
  items,
  busy,
  selectedIds,
  setSelectedIds,
  setDetail,
  rowMenuItems,
}: {
  items: ApplyQueueItem[];
  busy: boolean;
  selectedIds: number[];
  setSelectedIds: (ids: number[]) => void;
  setDetail: (item: ApplyQueueItem) => void;
  rowMenuItems: (record: ApplyQueueItem) => RowMenuItem[];
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后列头停在旧文案。
  useLocale();
  const buildMenu = useRowActionMenu();
  const run = useRowActionRunner();
  /** 右键菜单走全局单实例浮层（问题 25）：贴鼠标、夹进视口、层级取 `layer.aiPolish`。 */
  const contextMenu = useContextMenu();

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
      width: 220,
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
            {item.apply_supported === false && (
              // 和岗位广场上的「采集 / 手动」同一个位置放来源类标签：用户看来源就看这里。
              <Tooltip title={t("applyQueue.table.unsupportedHint")}>
                <Tag color="red" style={{ marginInlineEnd: 0 }}>
                  {t("applyQueue.table.unsupportedTag")}
                </Tag>
              </Tooltip>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: t("applyQueue.column.admission"),
      key: "admission",
      width: 140,
      render: (_, item) => <AdmissionTag item={item} />,
    },
    {
      title: t("applyQueue.column.status"),
      dataIndex: "status",
      width: 96,
      align: "center",
      render: (value: ApplyQueueItem["status"]) => {
        const meta = QUEUE_STATUS_META[value];
        return <Tag color={meta.color}>{t(QUEUE_STATUS_LABEL_KEYS[value])}</Tag>;
      },
    },
    {
      title: t("applyQueue.column.assets"),
      key: "assets",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0} style={{ width: "100%" }}>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: item.resume_title || t("applyQueue.detail.defaultResume") }}
          >
            {item.resume_title || t("applyQueue.detail.defaultResume")}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: item.greeting || t("applyQueue.detail.defaultGreeting") }}
          >
            {item.greeting || t("applyQueue.detail.defaultGreeting")}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("applyQueue.column.actions"),
      key: "actions",
      width: 64,
      // 表头与单元格一起右对齐：否则「操作」两字靠左、按钮靠右，看起来像没对齐（用户反馈过）。
      align: "right",
      render: (_, item) => (
        <div
          className="apply-queue-actions"
          style={{ display: "flex", justifyContent: "flex-end", marginLeft: "auto" }}
        >
          <Dropdown trigger={["click"]} menu={{ items: buildMenu(rowMenuItems(item)) }}>
            <Button
              size="small"
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
        dataSource={items}
        // 每页 10 条：队列条目行高较高，一页塞太多会把整屏挤满；分页形态与岗位广场 /
        // 简历中心一致（条数切换 + 总数显示）。hideOnSinglePage：队列很短时不打扰。
        pagination={{
          pageSize: 10,
          hideOnSinglePage: true,
          showSizeChanger: true,
          showTotal: (total) => t("applyQueue.table.total", { total }),
        }}
        rowSelection={rowSelection}
        tableLayout="fixed"
        // 空表时不启用横向滚动（与 `JobTable` 同一口径）：否则 `.ant-table-content` 会变成
        // "可横滚、区域内却没有任何可聚焦元素"的容器，命中 axe 的
        // `scrollable-region-focusable`（serious）。有数据时照旧按列宽固定横滚。
        scroll={items.length ? { x: 880 } : undefined}
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
