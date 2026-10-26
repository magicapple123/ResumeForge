// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料追加一条」的候选：由**当前组投影**派生（F4 §5.5）。
 *
 * ## 为什么改成投影
 *
 * 旧实现直接读旧资料接口（getProfile → 前端字段映射），既会绕过"当前组"过滤，也会让
 * 「追加的条目」与纸面生成两套映射各说各话。现在候选来自 `projectionCache`（新建/编辑/
 * 生成三处共享），`profileFillOptions` 按服务端给的 `paper_content_path` 从投影 content
 * 里取现成条目——追加的正是纸面上那一条。
 *
 * ## 为什么不在页面挂载时就请求
 *
 * 简历中心/详情页的主要工作是"看这份简历"；资料投影只在用户真的打开编辑器/制作台时才
 * 用得上（调用方传 `wanted`）。共享缓存让第二次打开不再发请求。
 *
 * ## 失败可重试
 *
 * 旧实现"失败一次永久空"：资料接口偶发失败后这条入口整场会话都不再出现。现在失败只写
 * 进 error，`reload()` 或重新打开 editor 都会重取；入口本身仍然静默降级（编辑器照常开）。
 */
import { useMemo } from "react";
import type { ResumeProfileUsageSnapshot } from "../../types/resumeProfileUsage";
import {
  buildProfileFillSources,
  type ProfileFillSources,
} from "../../features/profile/profileFillOptions";
import { withSavedResumeEditorView } from "../../features/profile/editorView";
import { useCurrentProjection } from "../../features/profile-library/useCurrentProjection";

export interface ProfileFillSourcesApi {
  /** 还没取到（或加载失败）时是 `null`：调用方据此完全不渲染这条入口。 */
  fillSources: ProfileFillSources | null;
  loading: boolean;
  /** 读取失败（不阻塞编辑器）；调用方可据此显示「重新读取资料候选」。 */
  error: Error | null;
  /** 失败后重试（会重新读取当前组投影）。 */
  reload: () => void;
}

/**
 * @param wanted 现在是"需要这条入口"吗（例如编辑弹窗打开、或制作台开着）。
 *   第一次变成 `true` 时读投影（命中共享缓存则不发请求）。
 * @param profileUsage 已保存简历的「本次使用」快照：给了就用**创建时冻结**的编辑器视图
 *   （F10），方案后来改了也不影响板块/字段；新建简历不传，直接按当前方案投影。
 */
export function useProfileFillSources(
  wanted: boolean,
  profileUsage?: ResumeProfileUsageSnapshot | null,
  savedResume = false,
): ProfileFillSourcesApi {
  const projection = useCurrentProjection(wanted);
  const fillSources = useMemo(() => {
    const base = projection.data ? buildProfileFillSources(projection.data) : null;
    if (!base) return null;
    // 新建流程（无已保存简历）用当前方案投影的视图；编辑已保存简历只用它自己的快照。
    return savedResume ? withSavedResumeEditorView(base, profileUsage) : base;
  }, [projection.data, profileUsage, savedResume]);
  return {
    fillSources,
    loading: projection.loading,
    error: projection.error,
    reload: projection.reload,
  };
}
