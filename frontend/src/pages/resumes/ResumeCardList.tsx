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
import { Button, Checkbox, Dropdown, Empty, Pagination, Popconfirm, Select, Space } from "antd";
import type { Dispatch, SetStateAction } from "react";
import LoadingBlock from "../../components/common/LoadingBlock";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { Page } from "../../types";
import type { ResumeBrief } from "../../types";
import { formatDateTime } from "../../utils/format";
import type { ResumeSortField, ResumeSortState } from "../../utils/resumeSort";

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
  sortState,
  onSortChange,
}: Props) {
  useLocale();
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
            {items.map((record) => (
              <li key={record.id} className="resume-card">
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
                    onClick={() => setPreviewId(record.id)}
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
                    disabled={favoriteResumeId === record.id}
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
                  <Button size="small" type="primary" ghost onClick={() => setPreviewId(record.id)}>
                    {t("responsive.resumes.preview")}
                  </Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "rename",
                          label: t("responsive.resumes.rename"),
                          onClick: () => {
                            setRenameTarget(record);
                            setRenameValue(record.title);
                          },
                        },
                        {
                          key: "note",
                          label: t("responsive.resumes.note"),
                          onClick: () => {
                            setNoteTarget(record);
                            setNoteValue(record.note ?? "");
                          },
                        },
                        {
                          key: "favorite",
                          label: t("responsive.resumes.favorite"),
                          onClick: () => void toggleFavorite(record),
                        },
                      ],
                    }}
                  >
                    <Button
                      size="small"
                      icon={<MoreOutlined />}
                      aria-label={t("responsive.resumes.more")}
                    />
                  </Dropdown>
                  {/* 删除走就地确认（不用 modal.confirm：`popupStackGuard` 禁止同层再叠一层）。 */}
                  <Popconfirm
                    title={t("responsive.resumes.remove.confirm")}
                    description={t("responsive.resumes.remove.body", {
                      note: t("common.note.trashRecovery"),
                    })}
                    okText={t("responsive.resumes.remove")}
                    cancelText={t("common.action.cancel")}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void remove(record.id)}
                  >
                    <Button size="small" danger type="text">
                      {t("responsive.resumes.remove")}
                    </Button>
                  </Popconfirm>
                </div>
              </li>
            ))}
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
