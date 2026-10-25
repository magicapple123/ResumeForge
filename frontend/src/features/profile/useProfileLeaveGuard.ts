// SPDX-License-Identifier: Apache-2.0
/**
 * 资料页离开守卫（F6 / R-26）：路由离开、程序触发切组、取消编辑**共用同一个出口**。
 *
 * 语义与制作台的 `useWorkbenchCloseGuard.needsCloseConfirm` 一致：**有未保存改动**才确认
 * （`needsLeaveConfirm = dirty`）。确认卡片由页面渲染（内联，不用 window.confirm）；
 * 本 hook 只负责"何时拦、拦下后确认/取消各做什么"：
 *
 * - 浏览器刷新/关标签：dirty 时挂 `beforeunload` 原生确认（复用既有 useBeforeUnloadGuard）；
 * - SPA 路由离开：react-router v7 `useBlocker`，dirty 时拦下；确认放弃才放行；
 * - 程序触发（取消编辑 / 切组）：`requestLeave` 挂起动作，确认后执行；
 * - 取消确认 = 继续编辑：清挂起、留在原页；**当前组与 sessionStorage 草稿都不动**
 *   （草稿由页面草稿 hook 管理，只有用户显式「丢弃草稿」才清）。
 */
import { useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import { useBeforeUnloadGuard } from "../../components/resume/useBeforeUnloadGuard";

/** 程序触发离开的种类：取消编辑 / 切换当前组（离页由路由 blocker 覆盖）。 */
export type ProfileLeaveKind = "cancel" | "switch-group" | "navigate";

interface PendingLeave {
  kind: Exclude<ProfileLeaveKind, "navigate">;
  action: () => void | Promise<void>;
}

export interface ProfileLeaveGuardOptions {
  /** 有任何未保存改动（表单/顺序/照片/识别回填任一）。 */
  dirty: boolean;
}

export interface ProfileLeaveGuard {
  /** 与 useWorkbenchCloseGuard.needsCloseConfirm 同语义。 */
  needsLeaveConfirm: boolean;
  /** 确认卡片是否要显示（路由被拦或程序触发挂起）。 */
  confirmOpen: boolean;
  /** 待处理的离开种类；null=没有待确认动作。 */
  pendingKind: ProfileLeaveKind | null;
  /** 程序触发离开：dirty 时挂起并等确认，否则立即执行。 */
  requestLeave: (kind: PendingLeave["kind"], action: () => void | Promise<void>) => void;
  /** 确认放弃：执行挂起的动作 / 放行被拦的路由。 */
  confirmDiscard: () => void;
  /** 继续编辑：清挂起并留在当前页（当前组与草稿保持不动）。 */
  cancelDiscard: () => void;
}

/**
 * `useBlocker` 只能在 data router 里调用；这里做一次"有没有 data router"的探测，
 * 没有时降级为空 blocker（仅保留 beforeunload 原生确认），避免在声明式 Router
 * 上下文（测试/嵌入页）里把整页打成错误屏。生产入口 main.tsx 已是 data router。
 *
 * 条件调用是刻意的：路由上下文的种类在应用生命周期内不会变化（生产 data router、
 * 测试声明式 router 二选一），因此 hook 顺序稳定；rules-of-hooks 无法静态证明这一点，
 * 故就地豁免并写明理由。
 */
function useOptionalBlocker(
  shouldBlock:
    | boolean
    | ((args: {
        currentLocation: { pathname: string };
        nextLocation: { pathname: string };
      }) => boolean),
) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  if (!dataRouter) return IDLE_BLOCKER;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 同上
  return useBlocker(shouldBlock);
}

type ProfileBlocker = ReturnType<typeof useBlocker>;
const IDLE_BLOCKER = {
  state: "unblocked",
  proceed: () => undefined,
  reset: () => undefined,
} as unknown as ProfileBlocker;

export function useProfileLeaveGuard({ dirty }: ProfileLeaveGuardOptions): ProfileLeaveGuard {
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const pendingRef = useRef<PendingLeave | null>(null);
  // dirty 时拦截 SPA 路由：只拦"真的换路径"，同页 query/hash 变化不算离开。
  const blocker = useOptionalBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnloadGuard(dirty);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // 保存成功（dirty=false）后：清挂起；被拦下的路由直接放行——此时已无内容可丢。
  useEffect(() => {
    if (dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 保存成功(dirty=false)后清挂起，无渲染路径可承载
    setPending(null);
    if (blocker.state === "blocked") blocker.reset();
    // blocker.reset 在状态变化后引用可能变，但它只在 blocked 时调用一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, blocker.state]);

  const requestLeave = (kind: PendingLeave["kind"], action: () => void | Promise<void>): void => {
    if (!dirty) {
      void action();
      return;
    }
    setPending({ kind, action });
  };

  const confirmDiscard = (): void => {
    const queued = pendingRef.current;
    if (queued !== null) {
      pendingRef.current = null;
      setPending(null);
      void queued.action();
      return;
    }
    if (blocker.state === "blocked") blocker.proceed();
  };

  const cancelDiscard = (): void => {
    pendingRef.current = null;
    setPending(null);
    if (blocker.state === "blocked") blocker.reset();
  };

  const routeBlocked = blocker.state === "blocked";
  return {
    needsLeaveConfirm: dirty,
    confirmOpen: pending !== null || routeBlocked,
    pendingKind: pending?.kind ?? (routeBlocked ? "navigate" : null),
    requestLeave,
    confirmDiscard,
    cancelDiscard,
  };
}
