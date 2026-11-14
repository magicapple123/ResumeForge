// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列的筛选与工具栏：状态/准入两个筛选、只看收藏、计数、全选、批量移出、
 * 投递前检查、来源不支持的清理入口、刷新，以及右侧的说明入口与批量套话术。
 * （自 ApplyQueuePanel 拆出：DOM、类名、Tooltip/Popconfirm 文案逐字随迁，
 * 状态仍由面板持有，这里只受控展示并回调。）
 *
 * #14 的三处改动：
 * - 「开始投递」搬去吸底条（`ApplyQueueStartBar`）——滚到下面还想投时工具栏已在视口外；
 * - 「来源不支持 N」从一条 58px 的黄色横幅变成工具栏 chip，点开就地确认后批量移出；
 * - 新增「投递前检查」（14A）与「只看收藏」（14B）。
 *
 * #14G/H 第二版（实测首屏只剩 2 行）：
 * - 工具栏**收成一行**（`flex-wrap: nowrap` + 横向滚动兜底）：原先把「全选队列」的跨页
 *   说明、「清空选择」、四个按钮排成第二行，白吃 44px；说明改挂 Tooltip，「清空选择」
 *   收进「⋯」——它只在勾选后才有意义，常驻是浪费；
 * - 队列标题行（「投递队列 ?」40px）整行删掉，说明 `?` 与「批量套用」并入本行右侧；
 * - 「投递前检查」与「刷新」改**图标按钮**（aria-label 保留，可被读屏找到）。
 */
import {
  FileTextOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SnippetsOutlined,
} from "@ant-design/icons";
import { Button, Popconfirm, Select, Space, Switch, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { QueueStatus } from "../../../types";
import {
  admissionFilterOptions,
  statusFilterOptions,
  type AdmissionFilterValue,
} from "./filterOptions";
import { UnsupportedQueueMenu } from "./UnsupportedQueueMenu";

export function QueueFilterBar({
  statusFilter,
  onStatusChange,
  admissionFilter,
  onAdmissionChange,
  favoriteOnly,
  onFavoriteOnlyChange,
  queueTotal,
  filteredCount,
  filterActive,
  selectedCount,
  selectableCount,
  unsupportedCount,
  busy,
  batchRemoving,
  loading,
  onSelectAll,
  onClearSelection,
  onRemoveSelected,
  onRemoveUnsupported,
  onPreflight,
  preflightLoading,
  onReload,
  onBatchTemplate,
  onResumeFit,
  guide,
}: {
  statusFilter: QueueStatus | undefined;
  onStatusChange: (value: QueueStatus | undefined) => void;
  admissionFilter: AdmissionFilterValue | undefined;
  onAdmissionChange: (value: AdmissionFilterValue | undefined) => void;
  /** #14B 只看收藏。 */
  favoriteOnly: boolean;
  onFavoriteOnlyChange: (value: boolean) => void;
  queueTotal: number;
  /** 筛选生效时表格里实际显示多少条。 */
  filteredCount: number;
  filterActive: boolean;
  selectedCount: number;
  /** 「全选队列」会勾上的条数（当前筛选结果里可投的那些）。 */
  selectableCount: number;
  /** 待投条目里来源不支持的条数（0 = 不显示清理 chip）。 */
  unsupportedCount: number;
  busy: boolean;
  batchRemoving: boolean;
  loading: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRemoveSelected: () => void;
  /** #14I 把来源不支持的待投条目一次移出。 */
  onRemoveUnsupported: () => void;
  /** #14A 打开体检抽屉（并跑一次检查）。 */
  onPreflight: () => void;
  preflightLoading: boolean;
  onReload: () => void;
  /** #14D 勾选后批量套用话术模板；未勾选时不显示。 */
  onBatchTemplate: () => void;
  /** #15D 勾选后批量看简历指派建议；未勾选时不显示（没有对象可优化）。 */
  onResumeFit: () => void;
  /** 队列说明入口（`?`）：由面板注入 `ApplyQueueGuide`，避免本组件依赖它。 */
  guide?: ReactNode;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后工具栏停在旧文案。
  useLocale();

  return (
    <div className="apply-queue-head">
      {/* F09：DOM 分三组（筛选 / 计数与批量动作 / 工具），由 CSS Grid 决定排布——
          容器 ≥1120px 时 `"filters batch tools"` 一行三组，窄于此仍按今天的两行
          （`"filters tools" / "batch batch"`）。分组是"能不能并排"的前提：原先两组
          各自 `space-between`，直接并排会把右侧图标插到行中间。
          只有**筛选**这一组进横向滚动容器：工具组（含 402px 说明气泡）必须常驻，
          否则气泡按被裁后的坐标定位，document 会多出 16px 横向滚动。 */}
      <div className="apply-queue-filters">
        <Space wrap={false} size={8} align="center">
          <Select
            allowClear
            placeholder={t("applyQueue.filter.byStatus")}
            style={{ width: 116 }}
            value={statusFilter}
            onChange={(value) => onStatusChange(value as QueueStatus | undefined)}
            options={statusFilterOptions()}
            aria-label={t("applyQueue.filter.byStatus")}
          />
          <Select
            allowClear
            placeholder={t("applyQueue.filter.byAdmission")}
            style={{ width: 116 }}
            value={admissionFilter}
            onChange={(value) => onAdmissionChange(value as AdmissionFilterValue | undefined)}
            options={admissionFilterOptions()}
            aria-label={t("applyQueue.filter.byAdmission")}
          />
          {/* 收藏是用户的强意图信号，做成独立开关而不是第三个下拉（只有开/关两态）。 */}
          <Space size={6}>
            <Switch
              size="small"
              checked={favoriteOnly}
              onChange={onFavoriteOnlyChange}
              aria-label={t("applyQueue.filter.favoriteOnly")}
            />
            <Typography.Text>{t("applyQueue.filter.favoriteOnly")}</Typography.Text>
          </Space>
        </Space>
      </div>
      <div className="apply-queue-batch">
        <Space size={8} wrap>
          <Typography.Text type="secondary">
            {filterActive
              ? t("applyQueue.filter.countFiltered", {
                  total: queueTotal,
                  shown: filteredCount,
                  selected: selectedCount,
                })
              : t("applyQueue.filter.count", { total: queueTotal, selected: selectedCount })}
          </Typography.Text>
          {/* 「跨页」属于条件信息：只在悬停里等于大多数人永远看不到（#35E）——挂 Tooltip 后
            不再占一整行文字（#14G 第二版）。 */}
          <Tooltip title={t("applyQueue.filter.selectAllHint")}>
            <Button disabled={busy || selectableCount === 0 || undefined} onClick={onSelectAll}>
              {t("applyQueue.filter.selectAll")}
            </Button>
          </Tooltip>
          <Popconfirm
            // 标题只留动作 + 对象：加数量会顶到「弹窗标题 ≤12 字」上限（§1.5），而选中几条
            // 在工具栏「已选 N 个」里就写着；后果与可逆性进正文（§4.4 三段式）。
            title={t("applyQueue.confirm.removeSelectedTitle")}
            description={t("applyQueue.confirm.removeBody")}
            okText={t("applyQueue.action.removeShort")}
            cancelText={t("common.action.cancel")}
            okButtonProps={{ danger: true }}
            disabled={busy || selectedCount === 0 || batchRemoving || undefined}
            onConfirm={onRemoveSelected}
          >
            <Button
              danger
              disabled={busy || selectedCount === 0 || undefined}
              loading={batchRemoving}
            >
              {t("applyQueue.action.removeSelected")}
            </Button>
          </Popconfirm>
          {/* F06：「清空选择」只在勾选后才有意义，直接条件渲染成文字按钮——常驻一个
              点开只有一条禁用项的「⋯」等于给用户一个空菜单。 */}
          {selectedCount > 0 ? (
            <Button
              type="link"
              size="small"
              onClick={onClearSelection}
              disabled={busy || undefined}
            >
              {t("applyQueue.filter.clearSelection")}
            </Button>
          ) : null}
        </Space>
      </div>
      {/* 工具组：体检 / 刷新 / 两个批量动作 / 来源不支持 / 说明。它们都是"对本页或对
          选中项做点什么"的入口，与计数、全选这类"读队列、改选择"分开成两组。 */}
      <div className="apply-queue-tools">
        <Space size={8} align="center" wrap={false}>
          <Tooltip title={t("applyQueue.action.preflight")}>
            <Button
              icon={<SafetyCertificateOutlined />}
              aria-label={t("applyQueue.action.preflight")}
              loading={preflightLoading}
              disabled={busy || undefined}
              onClick={onPreflight}
            />
          </Tooltip>
          <Tooltip title={t("common.action.refresh")}>
            <Button
              icon={<ReloadOutlined />}
              aria-label={t("common.action.refresh")}
              loading={loading}
              onClick={onReload}
            />
          </Tooltip>
          {selectedCount > 0 && (
            <>
              {/* #15D：勾选后才出现的第二个批量动作——「优化指派」要给谁优化，得先有对象。 */}
              <Tooltip title={t("applyQueue.insights.fit.action")}>
                <Button
                  icon={<FileTextOutlined />}
                  aria-label={t("applyQueue.insights.fit.action")}
                  onClick={onResumeFit}
                />
              </Tooltip>
              <Tooltip title={t("applyQueue.template.batch")}>
                <Button
                  icon={<SnippetsOutlined />}
                  aria-label={t("applyQueue.template.batch")}
                  onClick={onBatchTemplate}
                />
              </Tooltip>
            </>
          )}
          <UnsupportedQueueMenu
            count={unsupportedCount}
            busy={busy}
            onRemove={onRemoveUnsupported}
          />
          {guide}
        </Space>
      </div>
    </div>
  );
}
