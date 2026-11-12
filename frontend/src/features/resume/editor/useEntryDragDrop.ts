// SPDX-License-Identifier: Apache-2.0
/**
 * 一条条目卡的三域落点状态机（问题 21 从 `EntryCard` 拆出）。
 *
 * 界面上有三种落点指示，必须**互斥且唯一**：
 * - chip 级蓝条 `is-drop-before` / `is-drop-after`（合法落点）；
 * - chip 级禁用色描边 `is-drop-rejected`（非法或插完不动的落点）；
 * - 整框虚线 `is-dragover`（落在方框空白处 = 追加到组末尾）。
 *
 * 问题 21a 的根因是"蓝条"和"虚线框"各由一处 `setState` 管、互斥只做了一半：chip 的
 * `dragover` 只写 `dropTarget` 而从不复位 `dragOverZone`，两个底层区又漏了门控，于是
 * 虚线框与蓝条会同时出现、或移回空白处时闪一下。所以这里把三个状态收进同一处，并由
 * `chipOver` / `chipReject` / `chipLeave` / `chipDrop` 四个动作**成套**写入——不可能只写一半。
 *
 * 拆成独立文件的第二个原因：`EntryCard` 已贴 500 行预算（仓库的行数守卫），这套状态机
 * 是其中职责最独立的一段。
 */
import type { DragEvent } from "react";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/i18nContext";
import type {
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../../types/resumeDocument";
import { dropRejectReason, locatePath, moveItem, placementGroup } from "../document";
import { DRAG_REJECT_COPY } from "./dragRejectCopy";
import { useDocumentDrag } from "./documentDragContext";

/** chip 级的合法落点：插到该 chip 的前 / 后边缘。 */
export interface DropTarget {
  path: string;
  side: "before" | "after";
}

interface Args {
  document: ResumeDocument;
  entry: ResumeEntry;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export function useEntryDragDrop({ document, entry, onChange, onNotice }: Args) {
  const { t } = useI18n();
  const drag = useDocumentDrag();
  const [dragOverZone, setDragOverZone] = useState<Placement | null>(null);
  // #27：落点侧（插入线画在目标 chip 的前/后边缘）。语义不变：**只存合法落点**，
  // 拒绝态单独走 `rejectPath`（塞进 `DropSide` 会让 `resolveDropIndex` 收到第四种值）。
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // 问题 21a：非法 / no-op 落点。与 `dropTarget` 由同一批动作写入，永远二选一。
  const [rejectPath, setRejectPath] = useState<string | null>(null);

  // #9-B：被拿起的 item 从**整份文档**解析，不只看本条目。拖拽源可能在同板块的别的条目里。
  const draggedLocated = drag.draggedPath ? locatePath(document, drag.draggedPath) : null;
  const draggedItem: ResumeItem | null =
    draggedLocated?.kind === "item" ? draggedLocated.item : null;

  // #26：高亮从"正在拖拽"这一事实派生，不再依赖 dragleave 成对出现——空白处松手、
  // Esc 取消（只有 dragend）、拖去别的卡片时本卡都收不到 dragleave，虚线框因此残留。
  useEffect(() => {
    if (!drag.draggedPath) {
      setDragOverZone(null);
      setDropTarget(null);
      setRejectPath(null);
    }
  }, [drag.draggedPath]);

  const dropAt = (path: string, placement: Placement, toIndex?: number) => {
    // 从整份文档解析：目标 item 可能与拖拽源同条目，也可能在别的条目里（同板块内拖动）。
    const located = locatePath(document, path);
    if (!located || located.kind !== "item") return;
    const item = located.item;
    // 问题 13：三种拒绝原因的文案在这里统一出口（跨方框 / 正文块区 / 位置不允许），
    // 与 `dragend` 兜底用的是同一张 `DRAG_REJECT_COPY` 表——同一个原因不会有两种说法。
    const reject = dropRejectReason(item, placement);
    if (reject) {
      onNotice(t(DRAG_REJECT_COPY[reject]), "warning");
      return;
    }
    const next = moveItem(document, path, { placement, toIndex });
    if (next === document) {
      onNotice(t("document.drag.invalid"), "warning");
      return;
    }
    onChange(next);
    onNotice(t("document.drag.moved"), "info");
  };

  /**
   * 落在大框空白处 = 追加到该位置组末尾。
   *
   * 问题 13 只改了"非法落点"这一半：目标方框本身允许拖入时，整组 `is-dragover` 淡蓝底 +
   * 虚线已经足够明确，不改成禁止光标；但"本来就在末尾"必须明说，否则静默等于功能坏了。
   */
  const handleZoneDrop = (placement: Placement) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverZone(null);
    const path = event.dataTransfer.getData("text/plain") || drag.draggedPath;
    // `drop` 真的到达 → 文案由这里给，`dragend` 不能再补一条（否则两条提示打架）。
    drag.markRejected(null);
    if (!path) return;
    drag.setDraggedPath(null);
    if (draggedItem) {
      const group = placementGroup(entry.items, placement);
      const indexInGroup = group.findIndex((candidate) => candidate.id === draggedItem.id);
      if (indexInGroup >= 0 && indexInGroup === group.length - 1) {
        onNotice(t("document.drag.samePosition"), "warning");
        return;
      }
    }
    dropAt(path, placement);
  };

  const handleZoneOver = (placement: Placement) => (event: DragEvent<HTMLDivElement>) => {
    // 没有"我们发起的拖拽"就什么都不做（外部文件拖进来交给浏览器默认行为）。
    if (!draggedItem) return;
    // 2026-11-02 返工曾把 `dropEffect="none"` 全部去掉（它会让浏览器**不派发 drop**，
    // 于是非法落点既没有动作也没有提示）。问题 13 把它请回来，但**只给真正非法的方框**：
    // 原因记进来，松手后由拖拽源的 `dragend` 补一条可读提示。
    event.preventDefault();
    const reject = dropRejectReason(draggedItem, placement);
    if (reject) {
      drag.markRejected(reject);
      event.dataTransfer.dropEffect = "none";
      setDragOverZone(null);
      return;
    }
    drag.markRejected(null);
    event.dataTransfer.dropEffect = "move";
    // 高亮只在能落下的方框上亮：指示"松手会发生什么"，不能连拒绝的位置也描边。
    setDragOverZone(placement);
  };

  /** 合法 chip 落点：复位整框虚线 + 画蓝条 + 清掉上一个拒绝态（三件事一起做）。 */
  const chipOver = (path: string, side: DropTarget["side"]) => {
    setDragOverZone(null);
    setDropTarget({ path, side });
    setRejectPath(null);
  };

  /** 非法 / no-op 的 chip 落点：只描边，没有蓝条，也没有整框虚线。 */
  const chipReject = (path: string) => {
    setDragOverZone(null);
    setDropTarget(null);
    setRejectPath(path);
  };

  /**
   * 移开一个槽时清掉它的拒绝描边（否则描边会留在原地）。
   *
   * 只在**真的离开整个槽**时清：指针移进槽里的子元素同样会派发 dragleave，不判
   * `relatedTarget` 会让描边在子元素之间抖动。
   */
  const chipLeave = (path: string, event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setRejectPath((current) => (current === path ? null : current));
  };

  /** 落下去：两种 chip 级指示都收掉（结果文案由 `dropAt` / `dragend` 给）。 */
  const chipDrop = () => {
    setDropTarget(null);
    setRejectPath(null);
  };

  /**
   * 整框虚线的门控：只有**没有任何 chip 级指示**时才允许亮。
   *
   * 复位（上面四个动作）是根治，门控是兜底——只做复位会在"从空白进 chip"那一帧
   * 闪一下虚线框，只做门控则状态一直是脏的。
   */
  const zoneDragOver = (placement: Placement) =>
    dropTarget === null && rejectPath === null && dragOverZone === placement;

  return {
    draggedItem,
    dropTarget,
    rejectPath,
    dropAt,
    chipOver,
    chipReject,
    chipLeave,
    chipDrop,
    zoneDragOver,
    handleZoneOver,
    handleZoneDrop,
    handleZoneLeave: () => setDragOverZone(null),
  };
}
