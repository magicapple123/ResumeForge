// SPDX-License-Identifier: Apache-2.0
/**
 * 当前组状态与写操作（F6）：切换、新建、改名、删除（含 5 秒撤销）、参与清单。
 *
 * 唯一写入口放在这里，页面/弹层都经它调用；成功后统一 onChanged() 让宿主重取
 * workspace（服务端解析的顺序/参与清单才是唯一真相，前端不本地推导新组状态）。
 *
 * F9 起「大字段在资料页显示/隐藏」也归这里：隐藏 = 从当前组参与清单移除，显示 = 加回，
 * 与组编辑勾选框是同一份数据（R-21 基本信息恒参与，拒绝隐藏）。
 */
import { App } from "antd";
import { useCallback, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import * as api from "./api";
import { profileErrorMessage } from "../profile-library/errors";
import { invalidateProjectionCache } from "../profile-library/projectionCache";
import { restoreRecentlyDeleted } from "../profile-library/trashUndo";
import type { GroupBriefOut, GroupDeleteResult, GroupOut } from "./types";
import type { WorkspaceOut } from "../profile-library/types";

export interface CurrentProfileGroupApi {
  current: GroupBriefOut | null;
  groups: GroupBriefOut[];
  busy: boolean;
  switchTo: (groupId: string) => Promise<boolean>;
  /** 新建组：成功返回服务端创建的组（含 group_id），失败返回 null。 */
  create: (name: string) => Promise<GroupOut | null>;
  /** 改名：成功返回**服务端最新组**（含新 revision），调用方据此继续写参与清单。 */
  rename: (groupId: string, name: string) => Promise<GroupOut | null>;
  remove: (groupId: string) => Promise<boolean>;
  /** 写参与清单；expectedRevision 缺省用 workspace 里的 revision（同一弹层里连续写时不传会撞 409）。 */
  setMembers: (
    groupId: string,
    sectionKeys: string[],
    expectedRevision?: number,
  ) => Promise<boolean>;
  /** 当前组内某大字段「在资料页显示」开关；写参与清单后刷新 workspace。 */
  setSectionVisible: (sectionKey: string, visible: boolean) => Promise<boolean>;
  acknowledge: (noticeId: string) => Promise<void>;
}

export function useCurrentProfileGroup(
  workspace: WorkspaceOut | null,
  onChanged: () => Promise<void>,
): CurrentProfileGroupApi {
  const { message } = App.useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const revisionOf = useCallback(
    (groupId: string): number =>
      workspace?.groups.find((group) => group.group_id === groupId)?.revision ?? 0,
    [workspace],
  );

  /**
   * 写操作的唯一执行壳：成功 → 失效投影缓存 + 宿主重取 workspace；失败 → 映射成
   * 具体修复动作提示（409 带 revision 的语义在 profileErrorMessage 里）。
   * 返回 action 的结果；被 busy 挡住或抛错时返回 null（调用方据此区分成功/失败）。
   */
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | null> => {
      if (busy) return null;
      setBusy(true);
      try {
        const result = await action();
        invalidateProjectionCache();
        await onChanged();
        return result;
      } catch (err) {
        message.error(profileErrorMessage(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, message, onChanged],
  );

  const switchTo = useCallback(
    (groupId: string) => {
      if (!workspace) return Promise.resolve(false);
      return run(async () => {
        await api.switchCurrentGroup(groupId, workspace.workspace_revision);
        return true;
      }).then((result) => result === true);
    },
    [run, workspace],
  );

  const create = useCallback(
    async (name: string): Promise<GroupOut | null> => run(async () => api.createGroup(name)),
    [run],
  );

  const rename = useCallback(
    (groupId: string, name: string): Promise<GroupOut | null> =>
      run(async () => api.renameGroup(groupId, name, revisionOf(groupId))),
    [revisionOf, run],
  );

  const remove = useCallback(
    (groupId: string) => {
      const group = workspace?.groups.find((item) => item.group_id === groupId);
      if (!group) return Promise.resolve(false);
      const startedAt = Date.now();
      return run(async () => {
        const result: GroupDeleteResult = await api.deleteGroup(groupId, group.revision);
        toast.undo(t("profileGroups.manager.deleted", { name: group.name }), {
          label: t("profileGroups.manager.undo"),
          onClick: async () => {
            const restored = await restoreRecentlyDeleted("profile_group", group.name, startedAt);
            if (!restored)
              throw new Error(t("profileGroups.manager.restoreFailed", { detail: "-" }));
            await onChanged();
          },
        });
        void result;
        return true;
      }).then((result) => result === true);
    },
    [onChanged, run, toast, workspace],
  );

  const setMembers = useCallback(
    (groupId: string, sectionKeys: string[], expectedRevision?: number) =>
      run(async () => {
        // 连续写（先改名再写清单）必须用服务端刚返回的 revision：workspace 里那份
        // 在 onChanged 重取完成前是旧值，拿它写会必 409 revision_conflict（D1）。
        await api.setGroupMembers(groupId, sectionKeys, expectedRevision ?? revisionOf(groupId));
        return true;
      }).then((result) => result === true),
    [revisionOf, run],
  );

  /**
   * 大字段显示/隐藏：把 key 加进/移出当前组参与清单（整份替换）。
   * 基本信息恒参与（R-21），拒绝隐藏；已经是目标状态时不再发请求。
   */
  const setSectionVisible = useCallback(
    (sectionKey: string, visible: boolean) => {
      const current = workspace?.current_group;
      if (!current || sectionKey === "basic_info") return Promise.resolve(false);
      const already = current.participating_keys.includes(sectionKey);
      if (visible === already) return Promise.resolve(true);
      const nextKeys = visible
        ? [...current.participating_keys, sectionKey]
        : current.participating_keys.filter((key) => key !== sectionKey);
      return run(async () => {
        await api.setGroupMembers(current.group_id, nextKeys, current.revision);
        return true;
      }).then((result) => result === true);
    },
    [run, workspace],
  );

  const acknowledge = useCallback(
    async (noticeId: string): Promise<void> => {
      try {
        await api.acknowledgeNotice(noticeId);
        await onChanged();
      } catch (err) {
        message.error(profileErrorMessage(err));
      }
    },
    [message, onChanged],
  );

  return {
    current: workspace?.current_group ?? null,
    groups: workspace?.groups ?? [],
    busy,
    switchTo,
    create,
    rename,
    remove,
    setMembers,
    setSectionVisible,
    acknowledge,
  };
}
