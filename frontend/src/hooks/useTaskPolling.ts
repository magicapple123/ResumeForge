/**
 * 任务进度轮询：一轮完成后才排下一轮（single-flight），任务进入终态后自动停下。
 *
 * 为什么是轮询而不是 SSE：这是单用户本地应用，一次任务最多几百个岗位、间隔以秒计，
 * 轮询（1.5s）实现简单、断线自愈，成本可忽略；设计也明确采用轮询模型（§4.2）。
 * 为什么不用 setInterval：慢请求会叠加（上一轮没回来又发起下一轮）。改为「refresh 完成
 * 后再 setTimeout 下一轮」，进行中的轮次天然不重叠；连续失败按 1.5s→3s→6s 封顶退避。
 */
import { DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isCancellation } from "../api/client";
import type { ApplyTaskDetail, TaskStatus } from "../types";
import { isDocumentHidden, onVisibilityChange } from "../utils/visibility";
import { useDependencyVersion } from "./useDependencyVersion";

/** 仍在推进的状态：只有这些状态下才需要继续轮询。 */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "running",
  "paused",
  "breaker_paused",
];

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.includes(status);
}

const POLL_INTERVAL_MS = 1500;
/** 失败退避序列（毫秒）：连续失败第 1/2/3+ 次后的下一轮间隔，封顶 6s。 */
const BACKOFF_MS = [1500, 3000, 6000] as const;

interface TaskPollingState {
  detail: ApplyTaskDetail | null;
  error: string;
  /** 后端返回 404（任务记录不存在 / 已被清理）时置真：轮询停止，界面给「重试」入口。 */
  notFound: boolean;
  /** 手动拉取一次；返回是否成功（轮询循环据此决定退避，调用方通常 `void refresh()` 即可）。 */
  refresh: () => Promise<boolean>;
  setDetail: (detail: ApplyTaskDetail | null) => void;
}

/**
 * @param fetcher 拉取指定批次详情；对同一 `taskId` 应保持稳定语义（内部用 ref 取最新引用）。
 * @param taskId  要轮询的批次 id；为 `null` 时清空并停止。
 */
export function useTaskPolling(
  fetcher: (taskId: number) => Promise<ApplyTaskDetail>,
  taskId: number | null,
  deps: DependencyList = [],
): TaskPollingState {
  const dependencyVersion = useDependencyVersion(deps);
  const activeDependencyVersion = useRef(dependencyVersion);
  const activeTaskId = useRef(taskId);
  const [detail, setDetail] = useState<ApplyTaskDetail | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const version = useRef(0);
  // single-flight 标记与连续失败计数：轮询循环据此跳过叠加请求并做失败退避。
  const inFlight = useRef<number | null>(null);
  const failures = useRef(0);

  const fetcherRef = useRef(fetcher);
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）：声明在重置/重载 effect 之前。
  useEffect(() => {
    fetcherRef.current = fetcher;
    activeDependencyVersion.current = dependencyVersion;
    activeTaskId.current = taskId;
  });

  const refresh = useCallback(async (): Promise<boolean> => {
    if (
      taskId == null ||
      activeTaskId.current !== taskId ||
      activeDependencyVersion.current !== dependencyVersion
    )
      return false;
    const current = ++version.current;
    // 重试时先把 404 态撤掉再拉一次；后端仍返回 404 会重新置真。
    setNotFound(false);
    inFlight.current = current;
    try {
      const result = await fetcherRef.current(taskId);
      if (current === version.current) {
        setDetail(result);
        setError("");
      }
      return true;
    } catch (err) {
      if (current === version.current) {
        if (err instanceof ApiError && err.status === 404) {
          // 任务记录不存在（被清理 / 后端重启）：这不是可自愈的网络抖动，继续轮询
          // 只会每 1.5s 吃一个 404、界面永远停在「正在读取任务进度…」。
          setError("");
          setNotFound(true);
        } else if (!isCancellation(err)) {
          // 取消不进错误态；超时错误（「请求超时，请重试」）本身就是可重试的口径。
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      return false;
    } finally {
      if (inFlight.current === current) inFlight.current = null;
    }
  }, [taskId, dependencyVersion]);

  // 切换任务时清空旧详情，避免把上一个任务的状态显示成新任务的。
  // Compiler 规范：随 prop 变化的重置改到渲染期「调整状态」模式（守卫式 setState）。
  // 失败计数不在这里清（渲染期禁写 ref），放到下面的 taskId effect 里。
  const [prevTaskId, setPrevTaskId] = useState(taskId);
  if (prevTaskId !== taskId) {
    setPrevTaskId(taskId);
    setDetail(null);
    setError("");
    setNotFound(false);
  }

  useEffect(() => {
    version.current += 1;
    failures.current = 0;
    if (taskId != null) void refresh();
    return () => {
      version.current += 1;
    };
  }, [taskId, refresh]);

  // 仅在任务仍处于推进状态时轮询；进入终态后自动停止，避免空转。
  // 404 同样停止：任务记录已经不存在，轮询没有意义，由界面的「重试」重新拉起。
  // 每轮等上一轮 refresh 完成后再排下一轮（single-flight + 失败退避）；页面在后台时
  // 跳过本轮 tick，回到前台立即补一次。
  useEffect(() => {
    if (taskId == null || notFound) return;
    const status = detail?.status;
    if (status && !isActiveTaskStatus(status)) return;

    let disposed = false;
    let timer: number | undefined;

    const schedule = (delay: number) => {
      if (!disposed) timer = window.setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (disposed) return;
      // 后台跳过本轮（秒级轮询在后台纯属浪费）；single-flight：上一轮还没回来就不叠加。
      if (isDocumentHidden() || inFlight.current !== null) {
        schedule(POLL_INTERVAL_MS);
        return;
      }
      const ok = await refresh();
      if (disposed) return;
      if (ok) {
        failures.current = 0;
        schedule(POLL_INTERVAL_MS);
      } else {
        failures.current += 1;
        schedule(BACKOFF_MS[Math.min(failures.current, BACKOFF_MS.length) - 1]);
      }
    };

    const unsubscribeVisibility = onVisibilityChange(() => {
      if (disposed || isDocumentHidden()) return;
      // 前台补拉也别和进行中的请求叠加：in-flight 时它完成后自会排下一轮。
      if (inFlight.current !== null) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void tick();
    });

    // 启动轮询链：首轮由挂载 effect 的立即拉取负责，这里排下一轮（上一轮完成后继续）。
    schedule(POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribeVisibility();
    };
  }, [taskId, detail?.status, notFound, refresh]);

  return {
    detail,
    error,
    notFound,
    refresh,
    setDetail: (next) => {
      version.current += 1;
      setDetail(next);
    },
  };
}
