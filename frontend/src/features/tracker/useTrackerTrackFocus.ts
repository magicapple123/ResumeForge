// SPDX-License-Identifier: Apache-2.0
/**
 * `?track=N` 深链：把"这一条投递进度"从投递记录页带过来，并在列表里**指给用户看**（整改 #18）。
 *
 * ## 为什么不能用 `?job_id=` 顶替
 *
 * `/tracker?job_id=N` 是**按岗位筛选**（`TrackerPage` 的既有语义）。同一岗位可能有
 * 多条进度（不同渠道 / 不同时间），所以 `job_id` 只能把范围缩小，指不到"那一条"。
 * 后端回包里的 `track_id` 才是那一条，`?track=N` 也只能用它。
 *
 * ## 两段式（先解析、再高亮）
 *
 * 1. **解析**：`GET /tracker/{N}` 拿到这条的 `job_id`，把它并进筛选（与 `?job_id=`
 *    同一份 URL 状态）——否则那行可能不在当前页/当前筛选里，滚也滚不到；
 * 2. **高亮**：等列表真的加载出这一行（`loadedIds` 里出现）才 `scrollIntoView`
 *    并打高亮，`TRACK_FOCUS_HIGHLIGHT_MS` 后自动摘掉（`setTimeout`，卸载时清理）。
 *    **临时底色，不是常驻左色条**（那条已按用户意见砍掉）。
 *
 * ## 404 是正常分支
 *
 * 记录可能已被删：这时只提示一句、把 `track` 参数去掉，**保持用户原来的视图**
 * （不清空筛选、不空高亮、不抛未捕获错误）。
 */
import { useEffect, useRef, useState } from "react";
import { getTrack } from "../../api/tracker";
import { t } from "../../i18n";
import { useToast } from "../../hooks/useToast";

/** 高亮保留时长：够看清"就是这一条"，又不至于一直亮着。 */
export const TRACK_FOCUS_HIGHLIGHT_MS = 2000;

export interface TrackFocusOptions {
  /** URL 里的 `?track=N`（解析后的正整数；`null` = 没有这个深链）。 */
  trackId: number | null;
  /** 当前列表里**已经加载出来**的行 id：行到位才滚，避免滚到一个不存在的节点。 */
  loadedIds: readonly number[];
  /** 拿到这条进度的 `job_id`：并进筛选，否则那一行可能根本不在当前页。 */
  onFilterJob: (jobId: number) => void;
  /** 记录不存在/已删（404）：清掉 `track` 参数，页面留在列表。 */
  onMissing: () => void;
}

/**
 * 返回**当前要高亮的行 id**（`null` = 没有高亮）。
 *
 * 依赖里的三个回调必须稳定（页面用 `useCallback` 给），否则每次渲染都会取消上一次
 * 正在飞的请求。
 */
export function useTrackerTrackFocus({
  trackId,
  loadedIds,
  onFilterJob,
  onMissing,
}: TrackFocusOptions): number | null {
  const toast = useToast();
  const [target, setTarget] = useState<{ id: number; jobId: number | null } | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  /**
   * 已经**解析成功**的 trackId（用于避免重复请求同一条）。
   *
   * 关键：只在成功之后才赋值。若在 effect 开头就占位，`<StrictMode>` 的
   * "运行 effect → cleanup → 再运行 effect" 会让第二次直接早退，而第一次的响应已被
   * `cancelled` 丢掉 —— 于是 `setTarget` 永远不执行：URL 里躺着 `?track=15`，却既不
   * 回写 `job_id`、也不高亮、也不提示（实机表现就是这样，单测与 build 都看不出来）。
   * 把标记挪到 then 里，第二次 effect 就会重新取一次。
   */
  const resolvedFor = useRef<number | null>(null);
  /**
   * 已经点亮过的行 id。
   *
   * 不能用 `highlightedId` 自己当"点过没"的标记：到点把它清成 `null` 之后，下面的
   * 阶段二 effect 会因为"还没高亮"而**立刻再点亮一次**——于是高亮永远摘不掉（用户看到
   * 的是一块常驻底色，正是"不要左色条/常驻标记"那条要求要避免的）。用一个只进不退的
   * ref 记住"这一条点过了"，清除 action 才不会被自己撤销。
   */
  const appliedFor = useRef<number | null>(null);

  // 阶段一：id → (行 id, 岗位 id)。
  //
  // 这里的 setState 在 effect 里、却**不是**"从 props 派生 state"那种反模式：它要等
  // 一次网络往返（`GET /tracker/{N}`）回来才知道结果，没有更早的时机可以算。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (trackId === null) {
      resolvedFor.current = null;
      appliedFor.current = null;
      setTarget(null);
      setHighlightedId(null);
      return;
    }
    if (resolvedFor.current === trackId) return;
    let cancelled = false;
    void getTrack(trackId)
      .then((track) => {
        if (cancelled) return;
        // 成功后才占位（见上面 resolvedFor 的注释）。
        resolvedFor.current = trackId;
        setTarget({ id: track.id, jobId: track.job_id ?? null });
        // 先收窄到该岗位：同一岗位多条进度时列表仍能命中这一条。
        if (track.job_id != null) onFilterJob(track.job_id);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(t("trackerPage.trackFocus.missing"));
        onMissing();
      });
    return () => {
      cancelled = true;
    };
  }, [trackId, onFilterJob, onMissing, toast]);

  // 阶段二：等这一行真的在列表里，才把它点亮（"行到位"是外部数据的变化，不是渲染期
  // 能算出来的东西：列表是异步分页拉的）。
  useEffect(() => {
    if (target === null) return;
    if (appliedFor.current === target.id) return;
    if (!loadedIds.includes(target.id)) return;
    appliedFor.current = target.id;
    setHighlightedId(target.id);
  }, [target, loadedIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 滚动 + 到点摘掉高亮。timer 在卸载时清理（不留一个 2 秒后才炸的 setState）。
  useEffect(() => {
    if (highlightedId === null) return;
    const node = document.querySelector<HTMLElement>(`[data-track-id="${highlightedId}"]`);
    // jsdom 没有 scrollIntoView：类型上存在，运行时可能缺失，所以判一下再调。
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "center" });
    }
    const timer = setTimeout(() => setHighlightedId(null), TRACK_FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  return highlightedId;
}
