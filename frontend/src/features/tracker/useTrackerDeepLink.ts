// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页的三个深链参数：`?job_id=` / `?reminder=` / `?track=`（整改 #13 / #18）。
 *
 * ## 为什么必须只有一份实现
 *
 * 这三个参数来自不同地方：岗位详情页发 `job_id`、提醒通知发 `reminder`、投递记录的
 * 「查看进度」发 `track`。此前页面只读了 `job_id` 与 `status/keyword`，另外两个参数
 * 一路落空——后端早就在发精确链，前端不读就等于没做。
 *
 * 一旦三处各写一份 `searchParams.get(...)`，清理时就会互相覆盖：关闭提醒抽屉时把
 * `track` 一起删掉（用户刚点进来就被踢回全量列表），或者反过来。所以解析与清理都收在
 * 这里：**一次解析成三个整数**，清理时**只删自己那个键**，其余原样保留。
 *
 * ## 解析口径
 *
 * 正整数才认；缺省 / 非数字 / `0` / 负数一律当作"没有这个深链"。非法值不报错也不清参数
 * —— 它可能只是别人的链接拼错了，静默忽略比报错更不打扰（页面本身照常可用）。
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/** 三个深链参数解析后的形状。 */
export interface TrackerDeepLinks {
  /** `?job_id=N`：只看这个岗位的进度（岗位详情「该岗位的投递进度」）。 */
  jobId: number | null;
  /** `?reminder=N`：打开提醒弹窗并展开这条提醒的详情（提醒通知）。 */
  reminderId: number | null;
  /** `?track=N`：滚动定位并临时高亮这条进度（投递记录「查看进度」）。 */
  trackId: number | null;
}

/** 可以被单独清除的深链键。 */
export type TrackerDeepLinkKey = "job_id" | "reminder" | "track";

/** URL 参数里出现的键名（与后端的 deep_link 逐字对应，不许改名）。 */
export const TRACKER_DEEP_LINK_KEYS: readonly TrackerDeepLinkKey[] = ["job_id", "reminder", "track"];

/** 正整数才认：其余（缺省 / 非数字 / ≤0）都按"没有这个深链"处理。 */
export function parseDeepLinkId(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 从 URLSearchParams 一次解出三个 id（唯一实现）。 */
export function parseTrackerDeepLinks(params: URLSearchParams): TrackerDeepLinks {
  return {
    jobId: parseDeepLinkId(params.get("job_id")),
    reminderId: parseDeepLinkId(params.get("reminder")),
    trackId: parseDeepLinkId(params.get("track")),
  };
}

export interface TrackerDeepLinkState {
  links: TrackerDeepLinks;
  /** 只删指定键，其余参数（含 status/keyword 与另外两个深链）原样保留。 */
  clear: (key: TrackerDeepLinkKey) => void;
}

/** 页面级 hook：读当前 URL 的深链参数，并提供"只删自己"的清理函数。 */
export function useTrackerDeepLink(): TrackerDeepLinkState {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobRaw = searchParams.get("job_id");
  const reminderRaw = searchParams.get("reminder");
  const trackRaw = searchParams.get("track");

  // 依赖原始字符串而不是 searchParams 对象：后者每次渲染都是新实例，
  // useMemo 会退化成每次重算（下游 effect 的依赖也就不再稳定）。
  const links = useMemo<TrackerDeepLinks>(
    () => ({
      jobId: parseDeepLinkId(jobRaw),
      reminderId: parseDeepLinkId(reminderRaw),
      trackId: parseDeepLinkId(trackRaw),
    }),
    [jobRaw, reminderRaw, trackRaw],
  );

  const clear = useCallback(
    (key: TrackerDeepLinkKey) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(key);
          return next;
        },
        // replace：关抽屉不该在浏览器历史里留一步（返回键要回到"来这页之前"）。
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { links, clear };
}
