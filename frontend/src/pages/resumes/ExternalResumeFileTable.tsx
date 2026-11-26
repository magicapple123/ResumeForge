// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历列表的「文件行」表格（2026-11-26 整改 #3）。
 *
 * 原来的每一行是「文件名 + 外部标签 + N 字 + 关联岗位 + 时间」挤在一行副文案里：
 * 类型只能靠文件名后缀猜，状态（有没有提取到文字）排在中间，岗位与时间没有列、无法
 * 纵向对齐比较。现在按**文件行**重排：
 *
 * - 第一列「文件」：类型徽标（`fileKindOf`，接口本来就返回 `mime`）+ 文件名，
 *   副行**状态排第一**——「已提取 N 字」/「未提取到文字 · 扫描件或图片型 PDF」（警示色）；
 * - 岗位、上传时间各自成列：时间右对齐 + 等宽数字，没有关联岗位显示「—」；
 * - 每行不再有「外部」标签：整页都是外部简历，这个标签零信息量；
 * - 主操作按内容变：有文字 →「查看文本」，没文字 →「预览原件」；「用于面试」在没有
 *   文字时置灰并附说明（见 `RowActionItem.tooltip`）。
 *
 * 批量选择：勾选列**常驻 DOM**、默认靠 `visibility: collapse` 折叠
 * （`externalResumeFiles.css`），这样切进多选态时列宽不跳。入口两处——整行右键与行尾
 * 「⋯」里各一条「批量选择」：只放右键的话，不知道能右键的人永远找不到。
 *
 * 组件只负责呈现与事件转发：选择态、删除确认、取数都在 `ExternalResumePanel`。
 */
import { Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { memo, useMemo } from "react";
import type { HTMLAttributes } from "react";
import type { ExternalResumeItem } from "../../api/externalResumes";
import { RowActions, RowContextMenu } from "../../components/common/RowActions";
import type { RowActionItem, RowMenuItem } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { fileKindBadge, fileKindOf } from "../../utils/fileKind";
import { formatDateTime } from "../../utils/format";
import { batchSelectAction } from "./resumeTableActions";
import "./externalResumeFiles.css";

interface Props {
  items: ExternalResumeItem[];
  loading: boolean;
  batch: BatchSelection<number>;
  /** 多选态的整行右键菜单（目前只有「删除所选」）。 */
  batchActions: RowActionItem[];
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

/** 第一列：类型徽标 + 文件名 + 状态副行。 */
function fileCell(item: ExternalResumeItem) {
  const kind = fileKindOf(item.mime, item.name);
  // 已知类型给格式名（PDF / DOCX…，中英文一致）；只有不认识的类型才需要翻译。
  const badge = fileKindBadge(kind) ?? t("resumesPage.external.kindOther");
  return (
    <div className="external-resume-file">
      <div className="external-resume-file-line">
        <Tag className={`external-resume-kind external-resume-kind-${kind}`}>{badge}</Tag>
        <Typography.Text strong className="external-resume-name" ellipsis={{ tooltip: item.name }}>
          {item.name}
        </Typography.Text>
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

/** 第二列：关联岗位；没有关联（或还没关联）显示「—」，不留白格。 */
function jobCell(item: ExternalResumeItem) {
  if (!item.job_id) return <span className="external-resume-empty">—</span>;
  const title = item.job_title || `#${item.job_id}`;
  return (
    <Tag color="blue" className="external-resume-job">
      {title}
    </Tag>
  );
}

export default function ExternalResumeFileTable({
  items,
  loading,
  batch,
  batchActions,
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

  /** 主操作：按内容二选一（没有文字层的文件"查看文本"必然是一片空白）。 */
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
      render: (_, item) => fileCell(item),
    },
    {
      title: t("resumesPage.external.column.job"),
      key: "job",
      width: 200,
      ellipsis: true,
      render: (_, item) => jobCell(item),
    },
    {
      title: t("resumesPage.external.column.created"),
      dataIndex: "created_at",
      width: 168,
      align: "right",
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
    <Table<ExternalResumeItem>
      className={`external-resume-files${batch.selecting ? " is-selecting" : ""}`}
      rowKey="id"
      size="middle"
      columns={columns}
      dataSource={items}
      loading={loading}
      pagination={false}
      // 勾选列**始终挂载**：默认由 CSS 的 `visibility: collapse` 折叠，而不是靠
      // `rowSelection: undefined` 挂载/卸载整列——后者会让列宽在切多选态时跳一下。
      rowSelection={{
        selectedRowKeys: [...batch.selectedIds],
        onChange: (keys) => batch.setSelected(keys as number[]),
      }}
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
  );
}
