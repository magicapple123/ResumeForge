// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录的单个批次组（可展开）：组头是"批次时间 + 统计"，展开后是组内记录表。
 *
 * 从 ApplyRecordsPanel 拆出（B4 按需加载改造把该文件顶过了 500 行预算）。
 * 明细数据由父组件按需拉取（`/records/batches/{id}/items`，服务端分页），本组件
 * 只负责展示与翻页回调；批次的分组语义与删除入口见 ApplyRecordsPanel。
 */
import { CheckSquareOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { ReactNode } from "react";
import { RowActions } from "../common/RowActions";
import { isFromInnerControl } from "../common/recordDetailCore";
import { formatDateTime } from "../../utils/format";
import { TASK_STATUS_META, type ApplyRecord, type ApplyRecordBatch } from "../../types";
import { BATCH_ITEM_PAGE_SIZE, type BatchItemsState } from "../../types/applyBatchItems";
import { t } from "../../i18n";
import { TASK_STATUS_LABEL_KEYS } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

interface BatchGroupProps {
  batch: ApplyRecordBatch;
  expanded: boolean;
  /** 展开中批次的明细状态（B4 按需加载：首次展开/翻页时由父组件拉取）。 */
  itemsState: BatchItemsState | undefined;
  onToggle: () => void;
  onItemsPageChange: (page: number) => void;
  recordColumns: TableColumnsType<ApplyRecord>;
  onOpenDetail: (record: ApplyRecord) => void;
  onDeleteBatch: (batch: ApplyRecordBatch) => void;
  /** 批内明细的多选模式（多选范围＝批内明细表）。 */
  selecting: boolean;
  selectedRecordIds: number[];
  onSelectionChange: (ids: number[]) => void;
  /** 组头「更多」菜单的「批量选择」入口；多选模式收起单条操作。 */
  onEnterSelecting: () => void;
  /** 多选模式下的操作条（BatchActionBar），渲染在明细表上方。 */
  batchToolbar?: ReactNode;
}

/** 一个批次 = 一个可展开的组：组头是"批次时间 + 统计"，展开后是组内记录表。 */
export default function BatchGroup({
  batch,
  expanded,
  itemsState,
  onToggle,
  onItemsPageChange,
  recordColumns,
  onOpenDetail,
  onDeleteBatch,
  selecting,
  selectedRecordIds,
  onSelectionChange,
  onEnterSelecting,
  batchToolbar,
}: BatchGroupProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后组头停在旧文案。
  useLocale();
  const statusMeta = TASK_STATUS_META[batch.status];
  // 组头展示命中当前筛选的记录数（轻量分页不携带明细，这个数由后端给出）。
  const matchedCount = batch.matched_count ?? batch.items.length;
  return (
    <div className="apply-records-batch" data-testid={`record-batch-${batch.id}`}>
      {/* 组头是按钮（点击展开），所以「删除本批」必须在它**外面**——按钮不能嵌套按钮。 */}
      <div className="apply-records-batch-head-row">
        <button
          type="button"
          className="apply-records-batch-head"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <DownOutlined /> : <RightOutlined />}
          <Typography.Text strong>{t("applyUi.batch.heading", { id: batch.id })}</Typography.Text>
          <Typography.Text type="secondary">
            {formatDateTime(batch.finished_at || batch.created_at)}
          </Typography.Text>
          <Tag color={statusMeta.color}>{t(TASK_STATUS_LABEL_KEYS[batch.status])}</Tag>
          <span className="apply-records-batch-stats">
            <Typography.Text type="secondary">
              {t("applyUi.batch.recordCount", { count: matchedCount })}
              {batch.succeeded > 0 && (
                <Typography.Text type="success">
                  {" · "}
                  {t("applyUi.batch.succeeded", { count: batch.succeeded })}
                </Typography.Text>
              )}
              {batch.failed > 0 && (
                <Typography.Text type="danger">
                  {" · "}
                  {t("applyUi.batch.failed", { count: batch.failed })}
                </Typography.Text>
              )}
              {batch.skipped > 0 && (
                <Typography.Text type="secondary">
                  {" · "}
                  {t("applyUi.batch.skipped", { count: batch.skipped })}
                </Typography.Text>
              )}
            </Typography.Text>
          </span>
        </button>
        <RowActions
          more={
            selecting
              ? []
              : [
                  {
                    key: "batch_select",
                    label: t("applyUi.batch.selectMode"),
                    icon: <CheckSquareOutlined />,
                    onClick: onEnterSelecting,
                  },
                  {
                    key: "delete-batch",
                    label: t("applyUi.batch.deleteBatch", { count: matchedCount }),
                    danger: true,
                    confirm: t("applyUi.batch.deleteConfirm"),
                    // 标题与正文拆开（§4.4 例外）：条数只在正文里出现，标题只写动作 + 对象。
                    confirmBody: t("applyUi.batch.deleteConfirmBody", { count: matchedCount }),
                    onClick: () => onDeleteBatch(batch),
                  },
                ]
          }
        />
      </div>
      {/* 外层 wrap 是 grid（0fr→1fr）过渡容器：展开/收起时高度平滑变化；
          内容仍按 expanded 条件渲染，收起后不留 DOM（行为与断言不受影响）。 */}
      <div className={`apply-records-batch-body-wrap${expanded ? " is-expanded" : ""}`}>
        <div className="apply-records-batch-body">
          {expanded && (
            <>
              {selecting && batchToolbar}
              <Table<ApplyRecord>
                rowKey="id"
                size="small"
                columns={recordColumns}
                dataSource={itemsState?.items ?? []}
                loading={itemsState?.loading}
                rowSelection={
                  selecting
                    ? {
                        selectedRowKeys: selectedRecordIds,
                        onChange: (keys) => onSelectionChange(keys as number[]),
                      }
                    : undefined
                }
                // 明细走服务端分页（B4）：一批可能几百条，展开时只拉当前页。
                // 表内没有"上移/下移"类依赖 render 序号的操作（只有重投/详情/删除，都按 record 定位）。
                pagination={{
                  current: itemsState?.page ?? 1,
                  pageSize: BATCH_ITEM_PAGE_SIZE,
                  total: itemsState?.total ?? 0,
                  onChange: onItemsPageChange,
                  showSizeChanger: false,
                  hideOnSinglePage: (itemsState?.total ?? 0) <= BATCH_ITEM_PAGE_SIZE,
                }}
                scroll={{ y: 320 }}
                // 整行点击也能看详情；行内的「重投」按钮不会被这一层抢走。
                onRow={(record) => ({
                  onClick: (event) => {
                    if (isFromInnerControl(event)) return;
                    onOpenDetail(record);
                  },
                  style: { cursor: "pointer" },
                })}
                locale={{
                  emptyText: itemsState?.loading
                    ? t("applyUi.batch.loadingItems")
                    : t("applyUi.batch.emptyItems"),
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
