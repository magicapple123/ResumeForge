// SPDX-License-Identifier: Apache-2.0
/**
 * 删除 + 撤销：**软删类删除不再先问**。
 *
 * 判据只有一条：这件事能不能被 `restoreTrashItems` 撤销。
 * - 能（后端 16 类都是软删）→ 直接执行，Toast 里给 5 秒「撤销」；
 * - 不能（清空回收站 / 彻底删除）→ 仍然 Modal 确认 + `danger`（不走这里）。
 *
 * 撤销的本质是**调恢复接口**，不是"取消请求"：所以没有延迟队列、没有定时器回收——
 * 5 秒后 Toast 消失，用户仍可去回收站手动恢复。
 */
import { useMemo } from "react";
import { restoreTrashItems } from "../../api/trash";
import { t } from "../../i18n";
import { useToast } from "../../hooks/useToast";
import { UNDO_MAX_IDS } from "./trashType";
import type { TrashType } from "./trashType";

export interface UndoableDelete {
  type: TrashType;
  ids: readonly number[];
}

export interface DeleteUndoOptions {
  /** 恢复成功后刷新列表。 */
  onRestored?: () => void | Promise<void>;
}

export interface DeleteUndoApi {
  /**
   * 执行删除并给出撤销入口。
   * @returns 删除本身是否成功（撤销是后续动作，不影响返回值）。
   */
  run(
    target: UndoableDelete,
    remove: () => Promise<void>,
    options?: DeleteUndoOptions,
  ): Promise<boolean>;
}

export function useDeleteUndo(): DeleteUndoApi {
  const toast = useToast();

  // 返回稳定的对象：调用方常把它放进 useCallback 的依赖，每次渲染换新对象会让回调反复重建。
  return useMemo<DeleteUndoApi>(
    () => ({
      async run(target, remove, options) {
        const { type, ids } = target;
        if (ids.length === 0) return false;
        if (ids.length > UNDO_MAX_IDS) {
          // 大批量误触成本高、恢复载荷也大：调用方应当保留 Popconfirm（见方案 §3.4）。
          throw new Error(`useDeleteUndo: more than ${UNDO_MAX_IDS} ids must be confirmed first`);
        }

        // 删除失败直接抛给调用方：各页面怎么说这句话不一样（有的要带岗位名）。
        await remove();

        const text =
          ids.length === 1
            ? t("toast.deleted.single")
            : t("toast.deleted.batch", { count: ids.length });

        toast.undo(
          text,
          {
            label: t("toast.undo.label"),
            onClick: async () => {
              const result = await restoreTrashItems(ids.map((id) => ({ type_key: type, id })));
              const restored = result.restored ?? 0;
              if (restored === 0) {
                // 一条都没恢复：说清楚去哪手动恢复，而不是静默当作成功。
                toast.error(t("toast.restore.failed"));
                return;
              }
              toast.success(
                restored === 1
                  ? t("toast.restored.single")
                  : t("toast.restored.batch", { count: restored }),
              );
              await options?.onRestored?.();
            },
          },
          // 连续删同一条不叠卡片：key 绑在"类型 + 首条 id"上。
          { key: `undo-${type}-${ids[0]}` },
        );
        return true;
      },
    }),
    [toast],
  );
}
