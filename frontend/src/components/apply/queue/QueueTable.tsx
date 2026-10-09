/**
 * 投递队列表格：定宽列 + 行选择 + 右键菜单。
 * （自 ApplyQueuePanel 拆出：columns/rowSelection/<Table>/右键菜单三段整体搬，
 * contextMenu state 随唯一消费者下沉进本组件；rowMenuItems 经 prop 传入；
 * aria-label/类名/定宽注释逐字随迁，行为等价。）
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Menu, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import { useEffect, useRef, useState } from "react";
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
  rowMenuItems: (record: ApplyQueueItem) => MenuProps["items"];
}) {
  // 右键菜单：记录鼠标位置与目标行，用定位式 Menu 渲染（避免把 <tr> 包进 Dropdown 造成行重建竞态）。
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    record: ApplyQueueItem;
  } | null>(null);
  // 打开菜单时记下当时的焦点元素，关闭时还回去（Esc 关闭也不能把焦点丢在 body 上）。
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const closeContextMenu = () => {
    setContextMenu(null);
    const restoreTo = restoreFocusRef.current;
    restoreFocusRef.current = null;
    restoreTo?.focus({ preventScroll: true });
  };

  // Esc 关闭：遮罩层收不到键盘事件（焦点不在它上面），挂 window 监听并随菜单开关装卸。
  useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu]);

  /**
   * 列宽全部写死、`tableLayout="fixed"`：
   * 招呼语是用户可编辑的长文本，之前不设宽度时它会跟「准入 / 状态」抢空间——编辑过一条
   * 队列条目之后整张表就挤成一团。定宽 + 省略号让每列宽度只由表头决定，内容长短不再影响排版。
   */
  const columns: ColumnsType<ApplyQueueItem> = [
    {
      title: "岗位",
      dataIndex: "job_title",
      width: 220,
      render: (title: string, item) => (
        <Tooltip title={`加入队列于 ${formatDateTime(item.created_at)}`}>
          <Space orientation="vertical" size={0} style={{ width: "100%" }}>
            <Button
              type="link"
              className="table-text-link"
              onClick={() => setDetail(item)}
              aria-label={`查看队列条目详情：${title || "岗位已删除"}`}
            >
              {title || "（岗位已删除）"}
            </Button>
            <Space size={4} wrap>
              {item.company && (
                <Typography.Text type="secondary" ellipsis>
                  {item.company}
                </Typography.Text>
              )}
              {item.apply_supported === false && (
                // 和岗位广场上的「采集 / 手动」同一个位置放来源类标签：用户看来源就看这里。
                <Tooltip title="来源不在投递台支持的招聘网站内，无法自动投递；移出队列或到原网站自行投递">
                  <Tag color="red" style={{ marginInlineEnd: 0 }}>
                    来源不支持
                  </Tag>
                </Tooltip>
              )}
            </Space>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: "准入",
      key: "admission",
      width: 140,
      render: (_, item) => <AdmissionTag item={item} />,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 96,
      align: "center",
      render: (value: ApplyQueueItem["status"]) => {
        const meta = QUEUE_STATUS_META[value];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "简历 / 招呼语",
      key: "assets",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0} style={{ width: "100%" }}>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: item.resume_title || "按默认规则解析" }}
          >
            {item.resume_title || "按默认规则解析"}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: item.greeting || "默认招呼语" }}>
            {item.greeting || "默认招呼语"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 64,
      // 表头与单元格一起右对齐：否则「操作」两字靠左、按钮靠右，看起来像没对齐（用户反馈过）。
      align: "right",
      render: (_, item) => (
        <div
          className="apply-queue-actions"
          style={{ display: "flex", justifyContent: "flex-end", marginLeft: "auto" }}
        >
          <Dropdown trigger={["click"]} menu={{ items: rowMenuItems(item) }}>
            <Button
              size="small"
              aria-label={`更多操作 ${item.job_title}`}
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
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={rowSelection}
        tableLayout="fixed"
        scroll={{ x: 880 }}
        onRow={(record) => ({
          onContextMenu: (event) => {
            event.preventDefault();
            restoreFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setContextMenu({ x: event.clientX, y: event.clientY, record });
          },
        })}
      />
      {contextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1050 }}
            onClick={closeContextMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              closeContextMenu();
            }}
          />
          <Menu
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 1060,
              minWidth: 150,
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            }}
            items={rowMenuItems(contextMenu.record)}
            onClick={closeContextMenu}
          />
        </>
      )}
    </>
  );
}
