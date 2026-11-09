// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的**卡片视图**（窄屏，<1092）。
 *
 * 为什么需要它：表格的最小宽是 1494px（10 列都带显式 width），在 1092 视口下要横滚 660px
 * ——「操作」列虽然被钉在右边，但"标题 / 岗位 / 备注"这些要横向找，读一条记录像做一次定位。
 * 窄屏上一条记录本来就该是一行字 + 一组动作，所以这里换形态而不是继续横滚。
 *
 * 与表格**共用同一份状态**（受控组件，props 与 `ResumeTable` 的子集逐项对齐）：
 * 分页、排序、批量选择、收藏防连点、各入口的打开动作都由页面持有。
 * 这里只做"把一条记录画成一张卡"。
 */
import { MoreOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Empty, Pagination, Select, Space } from "antd";
import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import LoadingBlock from "../../components/common/LoadingBlock";
import { RowContextMenu } from "../../components/common/RowActions";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { Page } from "../../types";
import type { ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { formatDateTime } from "../../utils/format";
import type { ResumeSortField, ResumeSortState } from "../../utils/resumeSort";
import { batchSelectAction, secondaryActionsFor, type RowActionDeps } from "./resumeTableActions";

interface Props {
  data: Page<ResumeBrief> | undefined;
  loading: boolean;
  batch: BatchSelection<number>;
  favoriteResumeId: number | null;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
  toggleFavorite: (record: ResumeBrief) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setPreviewId: (id: number | null) => void;
  setRenameTarget: (target: ResumeBrief | null) => void;
  setRenameValue: (value: string) => void;
  setNoteTarget: (target: ResumeBrief | null) => void;
  setNoteValue: (value: string) => void;
  /** 「对比」等动作与表格视图共用同一份依赖（问题 26a：卡片视图不再自己维护一份清单）。 */
  setDiffBase: (target: ResumeBrief | null) => void;
  setDiffAgainstId: (id: number | null) => void;
  setDiffResult: (result: DiffViewData | null) => void;
  sortState: ResumeSortState;
  onSortChange: (next: ResumeSortState) => void;
}

/**
 * 排序可选项：与表格列头能排的那四列一一对应（字段名与 `utils/resumeSort` 同源）。
 * label 直接写 `MessageKey` 字面量而不是拼字符串：`t()` 的 key 是联合类型，`${}` 拼出来的
 * 字符串不在类型里，编译期查不出"少写了一个 key"。
 */
const SORT_OPTIONS: {
  value: ResumeSortField;
  labelKey:
    | "responsive.resumes.sort.updated"
    | "responsive.resumes.sort.created"
    | "responsive.resumes.sort.title"
    | "responsive.resumes.sort.job";
}[] = [
  { value: "updated", labelKey: "responsive.resumes.sort.updated" },
  { value: "created", labelKey: "responsive.resumes.sort.created" },
  { value: "title", labelKey: "responsive.resumes.sort.title" },
  { value: "job_title", labelKey: "responsive.resumes.sort.job" },
];

export default function ResumeCardList({
  data,
  loading,
  batch,
  favoriteResumeId,
  page,
  setPage,
  pageSize,
  setPageSize,
  toggleFavorite,
  remove,
  setPreviewId,
  setRenameTarget,
  setRenameValue,
  setNoteTarget,
  setNoteValue,
  setDiffBase,
  setDiffAgainstId,
  setDiffResult,
  sortState,
  onSortChange,
}: Props) {
  useLocale();
  const buildMenu = useRowActionMenu();
  /**
   * 卡片视图的 `⋯` 与整卡右键共用表格视图那一份动作清单（问题 26a）。
   * 原来这里手写了 3 项（重命名 / 备注 / 收藏），少了「对比」、删除也是另一套 Popconfirm，
   * 两个视图从加进来那天起就在各自演化。现在只在 `resumeTableActions` 里维护一份。
   */
  const deps = useMemo<RowActionDeps>(
    () => ({
      setPreviewId,
      setRenameTarget,
      setRenameValue,
      setNoteTarget,
      setNoteValue,
      setDiffBase,
      setDiffAgainstId,
      setDiffResult,
      toggleFavorite,
      remove,
    }),
    [
      setPreviewId,
      setRenameTarget,
      setRenameValue,
      setNoteTarget,
      setNoteValue,
      setDiffBase,
      setDiffAgainstId,
      setDiffResult,
      toggleFavorite,
      remove,
    ],
  );
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="resume-card-list">
      <div className="resume-card-toolbar">
        <Space size={8} wrap>
          <span className="resume-card-toolbar-label">{t("responsive.resumes.sort")}</span>
          <Select
            size="small"
            value={sortState.field}
            aria-label={t("responsive.resumes.sort")}
            options={SORT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            onChange={(field) =>
              // 换字段时用该字段的默认方向；再点同一字段在升/降序之间切换（与列头三态同义，
              // 卡片没有第三态"取消排序"——列表总要有个顺序）。
              onSortChange({
                field,
                order: sortState.field === field && sortState.order === "desc" ? "asc" : "desc",
                explicit: true,
              })
            }
          />
          <Button
            size="small"
            onClick={() =>
              onSortChange({
                ...sortState,
                order: sortState.order === "asc" ? "desc" : "asc",
                explicit: true,
              })
            }
          >
            {sortState.order === "asc"
              ? t("responsive.resumes.order.asc")
              : t("responsive.resumes.order.desc")}
          </Button>
          {batch.selecting ? (
            <Button size="small" onClick={() => batch.toggleAll(items.map((item) => item.id))}>
              {batch.selectedCount === items.length
                ? t("responsive.resumes.select.none")
                : t("responsive.resumes.select.page")}
            </Button>
          ) : null}
        </Space>
        <span className="resume-card-toolbar-total">
          {t("responsive.resumes.total", { count: total })}
        </span>
      </div>

      {/* 用仓库统一的 LoadingBlock 而不是裸 `<Spin spinning>`：`spinOutletGuard` 要求所有加载出口收口到它（一致的遮罩与最小高度）。 */}
      <LoadingBlock spinning={loading}>
        {items.length === 0 && !loading ? (
          <Empty description={t("responsive.resumes.empty")} />
        ) : (
          <ul className="resume-card-grid">
            {items.map((record) => {
              // 多选态下不接管右键：此时容易让人以为"只作用于这一张"，批量动作在页面批量工具条上。
              // 非多选态下第一项固定是「批量选择」——窄档（<1092）没有表格工具栏，
              // 这里是进入选择模式的唯一入口（与 ResumeTable 的右键/三点完全一致）。
              const actions = [
                batchSelectAction(batch.enterSelecting),
                ...secondaryActionsFor(record, deps),
              ];
              return (
                <RowContextMenu key={record.id} items={actions} disabled={batch.selecting}>
                  <li className="resume-card">
                    <div className="resume-card-head">
                      {batch.selecting ? (
                        <Checkbox
                          checked={batch.isSelected(record.id)}
                          aria-label={t("responsive.resumes.select.one")}
                          onChange={() => batch.toggle(record.id)}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="resume-card-title"
                        // 选择模式下标题不再打开预览（条目 01）：改用 `aria-disabled` + 早退，
                        // 而不是 `disabled`——标题一旦变灰，整张卡片的可读性都会下降；光标同步
                        // 改回箭头，避免"看起来能点"的假象。勾选框此时是唯一可用控件。
                        aria-disabled={batch.selecting || undefined}
                        style={batch.selecting ? { cursor: "default" } : undefined}
                        onClick={() => {
                          if (batch.selecting) return;
                          setPreviewId(record.id);
                        }}
                      >
                        {record.title}
                      </button>
                      <Button
                        size="small"
                        type="text"
                        aria-label={
                          record.favorite
                            ? t("responsive.resumes.unfavorite")
                            : t("responsive.resumes.favorite")
                        }
                        // 选择模式下收藏一并禁用：单条收藏与"对所选批量操作"是两条语义。
                        disabled={favoriteResumeId === record.id || batch.selecting}
                        icon={record.favorite ? <StarFilled /> : <StarOutlined />}
                        onClick={() => void toggleFavorite(record)}
                      />
                    </div>
                    <div className="resume-card-meta">
                      <span>{record.job_title || t("responsive.resumes.general")}</span>
                      {record.company ? <span>· {record.company}</span> : null}
                    </div>
                    <div className="resume-card-meta">
                      {t("responsive.resumes.card.meta", {
                        time: record.updated_at ? formatDateTime(record.updated_at) : "—",
                      })}
                    </div>
                    <div className="resume-card-actions">
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        // 选择模式下预览禁用（条目 01）：此时卡片只承担"勾选"这一件事。
                        disabled={batch.selecting}
                        onClick={() => setPreviewId(record.id)}
                      >
                        {t("responsive.resumes.preview")}
                      </Button>
                      {/* 与表格视图同一份菜单项（含「对比」与带二次确认的「删除」）；
                          选择模式下与整卡右键一致地禁用（右键已由 RowContextMenu 收起）。 */}
                      <Dropdown
                        trigger={["click"]}
                        menu={{ items: buildMenu(actions) }}
                        disabled={batch.selecting}
                      >
                        <Button
                          size="small"
                          icon={<MoreOutlined />}
                          aria-label={t("responsive.resumes.more")}
                          disabled={batch.selecting}
                        />
                      </Dropdown>
                    </div>
                  </li>
                </RowContextMenu>
              );
            })}
          </ul>
        )}
      </LoadingBlock>

      <Pagination
        className="resume-card-pagination"
        size="small"
        current={page}
        pageSize={pageSize}
        total={total}
        showSizeChanger
        pageSizeOptions={[10, 20, 50]}
        onChange={(nextPage, nextPageSize) => {
          setPage(nextPage);
          setPageSize(nextPageSize);
        }}
      />
    </div>
  );
}
