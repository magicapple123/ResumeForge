// SPDX-License-Identifier: Apache-2.0
/**
 * 平铺表格的**整行右键**行组件（从 `ResumeTable.tsx` 拆出，2026-11-26）。
 *
 * 拆出来的理由只有一个：`ResumeTable.tsx` 撞到 500 行预算。行组件与列定义是两块
 * 互不依赖的东西——行组件只认「这一行是谁 + 现在是不是多选态 + 一份动作依赖」，
 * 与列宽、排序、分页毫无关系。
 *
 * 仍然是 `memo`：props 全是稳定引用（antd 的 tr 属性 + record + 稳定的动作回调），
 * 页面级 state 变化因此不会触发整表行级重渲染。
 */
import { memo } from "react";
import type { HTMLAttributes } from "react";
import { RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import { useToast } from "../../hooks/useToast";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeBrief } from "../../types";
import { resumeRowMenuItems, type RowActionDeps } from "./resumeTableActions";

interface ContextMenuRowProps extends HTMLAttributes<HTMLTableRowElement> {
  record?: ResumeBrief;
  /** 批量选择模式下右键菜单收起，与行内操作保持一致。 */
  selecting: boolean;
  /** 进入多选模式并把这一行勾上（菜单项「批量选择」的动作），页面传入的稳定引用。 */
  enterSelecting: (id: number) => void;
  /** 多选态的整行右键菜单：与工具条的「批量操作」下拉同一组动作。 */
  batchActions: RowActionItem[];
  deps: RowActionDeps;
}

const ContextMenuRow = memo(function ContextMenuRow({
  record,
  selecting,
  enterSelecting,
  batchActions,
  deps,
  ...rest
}: ContextMenuRowProps) {
  // 必须在提前 return 之前调用（Hook 顺序），`record` 为空时用不上也无妨。
  const toast = useToast();
  useLocale();
  if (!record) return <tr {...rest} />;
  return (
    <RowContextMenu
      items={
        // 选择模式：只给批量动作（对所选这批做什么）；否则给单条动作全集。
        // 单条那一份与折叠视图的单版本组行、版本行共用 `resumeRowMenuItems`——
        // 各写一份的话，`secondaryActionsFor` 加一项就会有地方漏掉。
        selecting
          ? batchActions
          : resumeRowMenuItems(record, {
              deps,
              toast,
              // 右键点「批量选择」时，用户指的是**这一行**：进去之后它还空着就是断的。
              enterSelecting: () => enterSelecting(record.id),
            })
      }
    >
      <tr {...rest} />
    </RowContextMenu>
  );
});

export default ContextMenuRow;
