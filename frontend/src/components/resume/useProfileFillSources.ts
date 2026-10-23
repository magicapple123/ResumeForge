// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料追加一条」的候选：**按需取一次，之后复用**。
 *
 * ## 为什么不在页面挂载时就请求
 *
 * 简历中心/详情页的主要工作是"看这份简历"，`/profile` 只在用户真的打开「手动调整」或
 * 制作台中栏时才用得上。挂载就取意味着每打开一份简历都多一个与当前动作无关的请求，
 * 而这个接口在资料里存了照片/附件时并不便宜。
 *
 * ## 为什么失败要静默
 *
 * 这条入口是**加分项**：资料接口挂了就没有「从我的资料追加一条」，但编辑器本身必须照常
 * 打开（用户要改的是这份简历，不是资料）。所以 `catch` 之后把状态标成"取过了、没有候选"，
 * 既不弹错、也不阻塞渲染——与 `ResumeEditorModal` 的"不传 `fillSources` 就完全不渲染
 * 这条入口"是同一套降级语义。
 *
 * ## 只取一次（含失败）
 *
 * 用一个 ref 而不是 state 记录"取过没有"：它决定的是"要不要发请求"，属于事件处理器之间
 * 的事实；写在 state 里会让 `ensure` 的回调身份随状态变化，调用方的 effect 因此反复重跑。
 * 失败后同样标记为已取过：一次失败不该变成每次打开都再撞一次的超时等待。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getProfile } from "../../api/profile";
import {
  buildProfileFillSources,
  type ProfileFillSources,
} from "../../features/profile/profileFillOptions";

type LoadState = "idle" | "loading" | "done";

export interface ProfileFillSourcesApi {
  /** 还没取到（或资料接口失败）时是 `null`：调用方据此完全不渲染这条入口。 */
  fillSources: ProfileFillSources | null;
}

/**
 * @param wanted 现在是"需要这条入口"吗（例如编辑弹窗打开、或制作台开着）。
 *   第一次变成 `true` 时发一次请求；之后一直是 `true`/`false` 都不会再发。
 */
export function useProfileFillSources(wanted: boolean): ProfileFillSourcesApi {
  const [fillSources, setFillSources] = useState<ProfileFillSources | null>(null);
  const stateRef = useRef<LoadState>("idle");

  const ensure = useCallback(() => {
    if (stateRef.current !== "idle") return;
    stateRef.current = "loading";
    void getProfile()
      .then((profile) => {
        stateRef.current = "done";
        setFillSources(buildProfileFillSources(profile));
      })
      .catch(() => {
        // 静默降级：没有这条入口，但编辑器照常可开。
        stateRef.current = "done";
        setFillSources(null);
      });
  }, []);

  useEffect(() => {
    if (!wanted) return;
    ensure();
  }, [ensure, wanted]);

  return { fillSources };
}
