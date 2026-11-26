// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历列表的「文件行」表格（2026-11-26 整改 #3 / T09）。
 *
 * 原来的每一行是「文件名 + 外部标签 + N 字 + 关联岗位 + 时间」挤在一行副文案里：
 * 类型只能靠文件名后缀猜，状态（有没有提取到文字）排在中间，岗位与时间没有列、无法
 * 纵向对齐比较。现在按**文件行**重排：
 *
 * - 第一列「文件」：类型徽标（`fileKindOf`，接口本来就返回 `mime`）+ 文件名，
 *   副行**状态排第一**——「已提取 N 字」/「未提取到文字 · 扫描件或图片型 PDF」（警示色）；
 * - 岗位、上传时间各自成列：时间右对齐 + 等宽数字，没有关联岗位显示「—」；
 * - 岗位列可点（#4）：`Tag` 套 `Button type="link"`，跳 `/jobs?job_id=N`；
 *   岗位已被删除（外键 `SET NULL`，所以 `job_id` 为 null）时**不渲染链接**，
 *   避免死链；岗位名为空则文案回落到 `#id`，链接仍然可用。
 * - 每行不再有「外部」标签：整页都是外部简历，这个标签零信息量；
 * - 主操作按内容变：有文字 →「查看文本」，没文字 →「预览原件」；「用于面试」在没有
 *   文字时置灰并附说明（见 `RowActionItem.tooltip`）。
 *
 * ## 批量选择：非多选态**不挂载** `rowSelection`（T09 / R9-1）
 *
 * 旧实现把勾选列常驻 DOM、靠 CSS `visibility: collapse` 折叠，理由是"切多选态时列宽
 * 不跳"。但 Chrome 下 `<col>` 即使 collapse 也仍参与表头背景的绘制宽度——结果是表格
 * 左缘永远多出一条白带（勾选列那 40px 宽的表头背景铺不过去）。现在只有多选态才传
 * `rowSelection`，列根本不渲染：左缘白带从结构上消失，代价只是切进多选时列宽变化
 * 一次（用户刚点了"批量选择"，这一次变化反而是必要的反馈）。
 *
 * ## 点文件名即可打开（T09 / R9-2）
 *
 * 文件名本身就是最自然的入口。按**有没有文字层**分流：有文字 → 详情「文本」页
 * （用户想看的多半是正文），没有文字 → 「原件」页（文本页对他必然是一片空白）。
 *
 * ## 列头排序（T09 / R9-3）
 *
 * 三列可排（文件名 / 岗位 / 时间），三态箭头（升 → 降 → 取消）由 antd 的 `sorter: true`
 * 给出；排序**下推服务端**（`sort` / `order` 参数），状态存在 URL 里、由面板负责读写。
 * 本组件只把"哪一列、什么方向"翻译成 `ExternalSortState` 往上抛。
 *
 * 组件只负责呈现与事件转发：选择态、删除确认、取数、URL 都在 `ExternalResumePanel`。
 */
import { Button, Pagination, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { SortOrder } from "antd/es/table/interface";
import { memo, useMemo } from "react";
import type { HTMLAttributes } from "react";
import type {
  ExternalResumeItem,
  ExternalResumeSortKey,
  ExternalResumeSortOrder,
} from "../../api/externalResumes";
import { RowActions, RowContextMenu } from "../../components/common/RowActions";
import type { RowActionItem, RowMenuItem } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { fileKindBadge, fileKindOf } from "../../utils/fileKind";
import { formatDateTime } from "../../utils/format";
import { batchSelectAction } from "./resumeTableActions";
import "./externalResumeFiles.css";

/** 当前排序：字段 + 方向 + "用户是否显式点过列头"。 */
export interface ExternalSortState {
  field: ExternalResumeSortKey;
  order: ExternalResumeSortOrder;
  /** false = 默认排序（列头不显示箭头）；URL 里没有合法 `sort` 时就是它。 */
  explicit: boolean;
}

/** 默认排序：最近上传在前（与后端缺省值逐字一致，不显示箭头）。 */
export const DEFAULT_EXTERNAL_SORT_STATE: ExternalSortState = Object.freeze({
  field: "created_at",
  order: "desc",
  explicit: false,
});

/** 可排序字段白名单（其余值一律回落默认：`?sort=xxx` 不该被原样发给后端换 422）。 */
const SORT_KEYS: readonly ExternalResumeSortKey[] = [
  "name",
  "job_title",
  "created_at",
  "text_chars",
];

/** 列 key → 排序字段 + 该列的默认方向（决定第一次点击是升还是降）。 */
const SORT_COLUMNS = {
  file: { field: "name", defaultOrder: "asc" },
  job: { field: "job_title", defaultOrder: "asc" },
  created: { field: "created_at", defaultOrder: "desc" },
} as const satisfies Record<
  string,
  { field: ExternalResumeSortKey; defaultOrder: ExternalResumeSortOrder }
>;

type SortColumnKey = keyof typeof SORT_COLUMNS;

function isSortColumn(key: string): key is SortColumnKey {
  return key in SORT_COLUMNS;
}

/** URL 的 `?sort=&order=` → 排序状态；缺失/非法一律回落默认。 */
export function parseExternalSort(
  sort: string | null | undefined,
  order: string | null | undefined,
): ExternalSortState {
  if (!sort || !SORT_KEYS.includes(sort as ExternalResumeSortKey)) {
    return DEFAULT_EXTERNAL_SORT_STATE;
  }
  if (order !== "asc" && order !== "desc") return DEFAULT_EXTERNAL_SORT_STATE;
  return { field: sort as ExternalResumeSortKey, order, explicit: true };
}

/**
 * 受控 `sortOrder`：只有"用户点过的、且命中的"那一列显示箭头。
 *
 * 默认态一律 `null`：默认排序是接口不带参数时的行为，不是用户的选择；给它加箭头会让
 * 表头永远带高亮，与"取消排序回到默认"这个第三次点击自相矛盾。
 * `text_chars` 没有独立列头，因此它只可能以 URL 深链的形式存在、不显示箭头。
 */
function sortOrderFor(columnKey: string, state: ExternalSortState): SortOrder {
  if (!state.explicit || !isSortColumn(columnKey)) return null;
  if (SORT_COLUMNS[columnKey].field !== state.field) return null;
  return state.order === "asc" ? "ascend" : "descend";
}

/**
 * 该列的点击方向序列。
 *
 * 默认升序的列用 antd 的 `["ascend","descend"]`；默认降序的列（时间）必须反过来，
 * 否则第一次点击会被 antd 当成"取消排序"，而取消又回落到默认降序——用户看到的是
 * "点了没反应"（与内部简历表格同一处踩过的坑）。
 */
function sortDirectionsFor(columnKey: SortColumnKey): SortOrder[] {
  return SORT_COLUMNS[columnKey].defaultOrder === "asc"
    ? ["ascend", "descend"]
    : ["descend", "ascend"];
}

interface Props {
  items: ExternalResumeItem[];
  loading: boolean;
  batch: BatchSelection<number>;
  /** 多选态的整行右键菜单（目前只有「删除所选」）。 */
  batchActions: RowActionItem[];
  /** 跳转实现留在面板（`useNavigate` 不进到这个纯呈现组件里）。 */
  navigate: (path: string) => void;
  /** 当前排序（受控；面板从 URL 解析后传下来）。 */
  sortState: ExternalSortState;
  onSortChange: (next: ExternalSortState) => void;
  /** 服务端分页：页码/总数都由面板与 hook 决定，这里只渲染分页器。 */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onOpenText: (item: ExternalResumeItem) => void;
  onOpenOriginal: (item: ExternalResumeItem) => void;
  onOpenCheck: (item: ExternalResumeItem) => void;
  onUseForInterview: (item: ExternalResumeItem) => void;
  onDelete: (item: ExternalResumeItem) => void;
}

interface RowProps extends HTMLAttributes<HTMLTableRowElement> {
  record?: ExternalResumeItem;
  selecting: boolean;
  batchActions: RowActionItem[];
  rowMenu: (item: ExternalResumeItem) => RowMenuItem[];
}

/**
 * 带右键菜单的表格行。
 *
 * props 全是稳定引用（antd 的 `<tr>` 属性 + record + 两个稳定回调），memo 化的目的
 * 是让面板里"勾选/取消勾选"这类状态变化不重渲染整表的每一行。
 */
const ContextMenuRow = memo(function ContextMenuRow({
  record,
  selecting,
  batchActions,
  rowMenu,
  ...rest
}: RowProps) {
  if (!record) return <tr {...rest} />;
  // 选择模式：只给批量动作（对所选这批做什么）；否则给单条动作全集。
  return (
    <RowContextMenu items={selecting ? batchActions : rowMenu(record)}>
      <tr {...rest} />
    </RowContextMenu>
  );
});

/** 第一列：类型徽标 + 文件名（可点）+ 状态副行。 */
function fileCell(item: ExternalResumeItem, onOpen: (item: ExternalResumeItem) => void) {
  const kind = fileKindOf(item.mime, item.name);
  // 已知类型给格式名（PDF / DOCX…，中英文一致）；只有不认识的类型才需要翻译。
  const badge = fileKindBadge(kind) ?? t("resumesPage.external.kindOther");
  return (
    <div className="external-resume-file">
      <div className="external-resume-file-line">
        <Tag className={`external-resume-kind external-resume-kind-${kind}`}>{badge}</Tag>
        {/* 文件名就是主入口：按钮而不是 `<a>`——它打开的是弹层，不是导航。
            `title` 兜住省略号挡住的部分（长文件名在窄屏上必然被截）。 */}
        <Button
          type="link"
          className="external-resume-name"
          title={item.name}
          onClick={() => onOpen(item)}
        >
          {item.name}
        </Button>
      </div>
      {item.has_text ? (
        <Typography.Text type="secondary" className="external-resume-status">
          {t("resumesPage.external.extractedChars", { count: item.text_chars })}
        </Typography.Text>
      ) : (
        <Typography.Text type="warning" className="external-resume-status">
          {t("resumesPage.external.scanStatus")}
        </Typography.Text>
      )}
    </div>
  );
}

/**
 * 第二列：关联岗位。
 *
 * 三条分支各有理由：
 * - `job_id` 为空 → 显示「—」且**不给链接**：外键是 `ON DELETE SET NULL`，所以空
 *   既可能是"从没关联"也可能是"关联的岗位被删了"；两种情况都点不到东西，渲染链接
 *   就只能是死链。
 * - 岗位名为空但 id 有值 → 文案回落到 `#id`，链接照旧（详情抽屉用 id 打开）。
 * - 正常：`Tag` 套 `Button type="link"`（与 `ResumeTable.tsx` 的岗位列同一款），
 *   按钮天然可 Tab 到达，hover 有链接下划线反馈。
 */
function jobCell(item: ExternalResumeItem, navigate: (path: string) => void) {
  if (!item.job_id) return <span className="external-resume-empty">—</span>;
  const title = item.job_title || `#${item.job_id}`;
  return (
    <Button
      type="link"
      className="table-text-link external-resume-job-link"
      onClick={() => navigate(`/jobs?job_id=${item.job_id}`)}
    >
      <Tag color="blue" className="external-resume-job">
        {title}
      </Tag>
    </Button>
  );
}

export default function ExternalResumeFileTable({
  items,
  loading,
  batch,
  batchActions,
  navigate,
  sortState,
  onSortChange,
  page,
  pageSize,
  total,
  onPageChange,
  onOpenText,
  onOpenOriginal,
  onOpenCheck,
  onUseForInterview,
  onDelete,
}: Props) {
  useLocale(); // 本组件用模块级 t()，必须订阅语言变化（见 i18n/localeSubscription.test.ts）

  /** rowKey → record：行渲染 O(1) 取值，避免对 items 逐条 find（O(n²)）。 */
  const itemsByRowKey = useMemo(() => {
    const map = new Map<string, ExternalResumeItem>();
    for (const item of items) map.set(String(item.id), item);
    return map;
  }, [items]);

  /** 有文字看文本、没文字看原件（没有文字层时"查看文本"必然一片空白）。 */
  const openByContent = (item: ExternalResumeItem): void =>
    item.has_text ? onOpenText(item) : onOpenOriginal(item);

  /** 主操作：按内容二选一。 */
  const mainAction = (item: ExternalResumeItem): RowActionItem =>
    item.has_text
      ? {
          key: "text",
          label: t("resumesPage.external.viewText"),
          onClick: () => onOpenText(item),
        }
      : {
          key: "preview",
          label: t("resumesPage.external.preview"),
          onClick: () => onOpenOriginal(item),
        };

  /** 单条动作全集：行尾「⋯」与整行右键共用这一份，两处不会漂。 */
  const rowMenu = (item: ExternalResumeItem): RowMenuItem[] => [
    mainAction(item),
    // 另一个查看入口也留在菜单里：想看原件的人不必先用"有没有文字"判断路径。
    item.has_text
      ? {
          key: "preview",
          label: t("resumesPage.external.preview"),
          onClick: () => onOpenOriginal(item),
        }
      : {
          key: "text",
          label: t("resumesPage.external.viewText"),
          onClick: () => onOpenText(item),
        },
    { key: "check", label: t("resumesPage.external.check"), onClick: () => onOpenCheck(item) },
    // 多选入口：默认观感不变，点过之后才出现勾选列与批量条。
    batchSelectAction(batch.enterSelecting),
    { key: "divider-actions", type: "divider" },
    {
      key: "delete",
      label: t("resumesPage.external.delete"),
      danger: true,
      // 软删、不弹确认：撤销入口在 Toast 上（见面板的 handleDelete）。
      undo: true,
      onClick: () => onDelete(item),
    },
  ];

  /** 平铺在行上的主操作：「查看/预览」+「用于面试」（没有文字时置灰并说明原因）。 */
  const primaryActions = (item: ExternalResumeItem): RowActionItem[] => [
    mainAction(item),
    {
      key: "interview",
      label: t("resumesPage.external.useForInterview"),
      disabled: !item.has_text,
      // 置灰必须带说明：否则用户只看到一颗点不动的按钮，不知道要先有文字层。
      tooltip: item.has_text ? undefined : t("resumesPage.external.noTextForInterview"),
      onClick: () => onUseForInterview(item),
    },
  ];

  const columns: TableColumnsType<ExternalResumeItem> = [
    {
      title: t("resumesPage.external.column.file"),
      key: "file",
      sorter: true,
      sortOrder: sortOrderFor("file", sortState),
      sortDirections: sortDirectionsFor("file"),
      render: (_, item) => fileCell(item, openByContent),
    },
    {
      title: t("resumesPage.external.column.job"),
      key: "job",
      width: 200,
      ellipsis: true,
      sorter: true,
      sortOrder: sortOrderFor("job", sortState),
      sortDirections: sortDirectionsFor("job"),
      render: (_, item) => jobCell(item, navigate),
    },
    {
      title: t("resumesPage.external.column.created"),
      key: "created",
      dataIndex: "created_at",
      width: 168,
      align: "right",
      sorter: true,
      sortOrder: sortOrderFor("created", sortState),
      sortDirections: sortDirectionsFor("created"),
      // 右对齐 + 等宽数字：时间列纵向能对齐到秒，扫一眼就能比较先后。
      className: "external-resume-time",
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("resumesPage.external.column.actions"),
      key: "actions",
      width: 220,
      align: "right",
      render: (_, item) => (
        // 「⋯」= 菜单里除已平铺的主操作之外的部分；选择模式下整列禁用，
        // 避免"勾着这一批、又点了单条动作"的语义冲突。
        <RowActions
          primary={primaryActions(item)}
          more={rowMenu(item).filter(
            (entry) => entry.type === "divider" || (entry.key !== "text" && entry.key !== "preview"),
          )}
          disabled={batch.selecting}
        />
      ),
    },
  ];

  return (
    <div className="external-resume-files-wrapper">
      <Table<ExternalResumeItem>
        className={`external-resume-files${batch.selecting ? " is-selecting" : ""}`}
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={false}
        // 排序状态由面板（URL）持有；这里只报告"点了哪一列、什么方向"。
        // 第三次点击（`order` 为空）回到默认排序——服务端默认值就是 `created_at desc`。
        //
        // 取消排序必须**先于** `columnKey` 判断：antd 6 取消排序时把 `columnKey` 也一并
        // 置成 `undefined`（`generateSorterInfo` 的 legacy 兼容分支），先查 `columnKey`
        // 会让"第三次点击"直接 return ——用户看到的是一次点了没反应、也回不到默认顺序。
        onChange={(_pagination, _filters, sorter, extra) => {
          if (extra.action !== "sort") return;
          const active = Array.isArray(sorter) ? sorter[0] : sorter;
          const direction = active?.order ?? null;
          if (!direction) {
            onSortChange(DEFAULT_EXTERNAL_SORT_STATE);
            return;
          }
          const columnKey = String(active?.columnKey ?? "");
          if (!isSortColumn(columnKey)) return;
          onSortChange({
            field: SORT_COLUMNS[columnKey].field,
            order: direction === "ascend" ? "asc" : "desc",
            explicit: true,
          });
        }}
        // 勾选列**只在多选态挂载**：常驻 + `visibility: collapse` 会在表格左缘留下一条
        // 表头背景铺不过去的白带（Chrome 下 `<col>` 仍参与表头绘制宽度），见文件头注释。
        rowSelection={
          batch.selecting
            ? {
                selectedRowKeys: [...batch.selectedIds],
                onChange: (keys) => batch.setSelected(keys as number[]),
              }
            : undefined
        }
        components={{
          body: {
            row: (props: HTMLAttributes<HTMLTableRowElement>) => {
              const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
              return (
                <ContextMenuRow
                  {...props}
                  record={itemsByRowKey.get(rowKey)}
                  selecting={batch.selecting}
                  batchActions={batchActions}
                  rowMenu={rowMenu}
                />
              );
            },
          },
        }}
      />
      {/* 服务端分页：只有超过一页才出现（几份简历时不该多一行控件）。
          用独立的 `Pagination` 而不是 Table 自带分页：`dataSource` 只是**当前页**，
          交给 Table 再切一次会把当页数据切空。 */}
      {total > pageSize ? (
        <div className="external-resume-pagination">
          <Pagination
            size="small"
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={onPageChange}
          />
        </div>
      ) : null}
    </div>
  );
}
