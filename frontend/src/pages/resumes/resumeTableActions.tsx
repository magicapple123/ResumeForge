// SPDX-License-Identifier: Apache-2.0
/**
 * 简历列表行的动作构造（2026-10-27）。
 *
 * 从 `ResumeTable.tsx` 搬出来：这些 builder 是**纯数据构造**——不碰行状态、不碰弹窗，
 * 只把页面传下来的 setState 回调拼成 `RowActionItem`。搬出来之后表格文件回到 500 行
 * 预算内（与 `resumeRowCopyActions.tsx` 同一拆分理由）。
 *
 * 文案一律走 `t()`；调用方组件（ResumeTable / ContextMenuRow）负责 `useLocale()` 订阅。
 */
import { CheckSquareOutlined } from "@ant-design/icons";
import type { RowActionItem } from "../../components/common/RowActions";
import type { CopyNotifier } from "../../components/common/copyMenu";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { copyMenuFor } from "./resumeRowCopyActions";

/** 行操作动作的依赖集：全部是 setState 与 useCallback 回调，引用跨渲染稳定，
 * 行组件据此做 memo——页面其它 state 变化时已渲染的行不必重跑。 */
export interface RowActionDeps {
  setPreviewId: (id: number | null) => void;
  setRenameTarget: (target: ResumeBrief | null) => void;
  setRenameValue: (value: string) => void;
  setNoteTarget: (target: ResumeBrief | null) => void;
  setNoteValue: (value: string) => void;
  setDiffBase: (target: ResumeBrief | null) => void;
  setDiffAgainstId: (id: number | null) => void;
  setDiffResult: (result: DiffViewData | null) => void;
  toggleFavorite: (record: ResumeBrief) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export function primaryActionsFor(record: ResumeBrief, deps: RowActionDeps): RowActionItem[] {
  return [
    {
      key: "preview",
      label: t("resumes.list.preview"),
      onClick: () => deps.setPreviewId(record.id),
    },
  ];
}

export function secondaryActionsFor(record: ResumeBrief, deps: RowActionDeps): RowActionItem[] {
  return [
    {
      key: "rename",
      label: t("resumes.list.rename"),
      onClick: () => {
        deps.setRenameTarget(record);
        deps.setRenameValue(record.title);
      },
    },
    {
      key: "note",
      label: t("resumes.list.note"),
      onClick: () => {
        deps.setNoteTarget(record);
        deps.setNoteValue(record.note ?? "");
      },
    },
    {
      key: "diff",
      label: t("resumes.list.diff"),
      onClick: () => {
        deps.setDiffBase(record);
        deps.setDiffAgainstId(null);
        deps.setDiffResult(null);
      },
    },
    {
      key: "favorite",
      label: record.favorite ? t("resumes.list.unfavorite") : t("resumes.list.favorite"),
      onClick: () => void deps.toggleFavorite(record),
    },
    {
      key: "delete",
      label: t("common.action.delete"),
      danger: true,
      confirm: t("resumes.list.deleteTitle"),
      confirmBody: t("resumes.list.deleteBody"), // 正文补「对象」段（§4.4 三段式的第三段）
      // 按钮写具体动作（AGENTS：禁用「确定/取消」泛动词；QA R.07 实测为默认「取 消 / 确 定」）。
      confirmOkText: t("resumes.remove.confirm.ok"),
      confirmCancelText: t("resumes.remove.confirm.cancel"),
      onClick: () => void deps.remove(record.id),
    },
  ];
}

/** 右键菜单顶部的「批量选择」入口：工具栏按钮已收进这里（R8），点它进入多选模式。 */
export function batchSelectAction(enterSelecting: () => void): RowActionItem {
  return {
    key: "batch_select",
    label: t("common.action.batchSelect"),
    icon: <CheckSquareOutlined />,
    onClick: enterSelecting,
  };
}

/**
 * 单条行（平铺表格的行 / 折叠表里的单版本组行 / 展开后的版本行）的**菜单项全集**：
 * 主操作 + 「复制」子菜单 + 次级操作（含删除）。
 *
 * 三处共用这一份：折叠视图上线时的验收要求"单版本行的右键与平铺行同一份 builder"，
 * 各写一份的话，`secondaryActionsFor` 加一项就会有地方漏掉。
 *
 * `enterSelecting` 为空表示**不给批量选择**（版本行：多版本组不可整组勾选，给了会引导
 * 用户删整组）。
 */
export function resumeRowMenuItems(
  record: ResumeBrief,
  ctx: { deps: RowActionDeps; toast: CopyNotifier; enterSelecting?: () => void },
): RowActionItem[] {
  return [
    ...(ctx.enterSelecting ? [batchSelectAction(ctx.enterSelecting)] : []),
    ...primaryActionsFor(record, ctx.deps),
    // 标题 / 目标岗位 / 公司 / 备注 / 整行（贴招聘表单、发内推、粘进表格）。
    copyMenuFor(record, ctx.toast),
    ...secondaryActionsFor(record, ctx.deps),
  ];
}
