/**
 * 职责⑦：智能逐项填表（live）会话与「记住资料目标」弹窗的状态域。
 * （自 WebFormPage 拆出：live/liveOptOut/memoryTargets/memoryTargetsLoading/memorySaving/
 * memoryDialogOpen/memoryPendingKey(ref) 全部 state 随唯一消费域下沉，
 * 5 个 effect 原样搬运（初始状态/1.5s 轮询/记忆目标去重/自动开启/stopped 收拢）；
 * handleLiveToggle/handleMemorySubmit/handleEndSession 留在页面（耦合 busy 联合态），
 * 经本 hook 返回的 setter 操作。）
 */
import { useEffect, useRef, useState } from "react";
import type { App } from "antd";
import { getWebFormLiveStatus, getWebFormMemoryTargets, startWebFormLive } from "../../api/webform";
import type { WebFormLive, WebFormMemoryTarget } from "../../types";
import { isDocumentHidden, onVisibilityChange } from "../../utils/visibility";

export function useLiveSession({
  restoredLiveOptOut,
  browserState,
  running,
  aiAvailable,
  aiOn,
  setSessionActive,
  message,
}: {
  restoredLiveOptOut: boolean;
  browserState: string | undefined;
  running: boolean;
  aiAvailable: boolean | null;
  aiOn: boolean;
  setSessionActive: (active: boolean) => void;
  message: ReturnType<typeof App.useApp>["message"];
}): {
  live: WebFormLive | null;
  setLive: (live: WebFormLive | null) => void;
  liveOptOut: boolean;
  setLiveOptOut: (optOut: boolean) => void;
  rememberPending: WebFormLive["remember_pending"];
  memoryTargets: WebFormMemoryTarget[];
  memoryTargetsLoading: boolean;
  memorySaving: boolean;
  setMemorySaving: (saving: boolean) => void;
  memoryDialogOpen: boolean;
  setMemoryDialogOpen: (open: boolean) => void;
} {
  const [live, setLive] = useState<WebFormLive | null>(null);
  const [liveOptOut, setLiveOptOut] = useState(restoredLiveOptOut);
  const liveStarting = useRef(false);
  const [memoryTargets, setMemoryTargets] = useState<WebFormMemoryTarget[]>([]);
  const [memoryTargetsLoading, setMemoryTargetsLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const memoryPendingKey = useRef("");

  const rememberPending = live?.remember_pending ?? null;
  const rememberPendingSignature = rememberPending
    ? [rememberPending.field_key, rememberPending.value, rememberPending.field_label].join("|")
    : "";

  // 页面从「我的资料」等其他界面回来时，实时会话状态由后端恢复，不重新要求用户开启。
  useEffect(() => {
    let cancelled = false;
    void getWebFormLiveStatus()
      .then((next) => {
        if (cancelled) return;
        setLive(next);
        if (next.running) setSessionActive(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉取一次实时状态，其余值由轮询 effect 维护
  }, []);

  // 模式开着的时候轮询状态（面板在浏览器里，这边要能看到它在做什么）。
  // 关掉就停——不留一个永远转的定时器。
  // 页面在后台时跳过本轮 tick；回到前台由 visibilitychange 立即补一次。
  useEffect(() => {
    if (!live?.running) return;
    const poll = () => {
      void getWebFormLiveStatus()
        .then((next) => {
          setLive(next);
          if (next.running) setSessionActive(true);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(() => {
      if (isDocumentHidden()) return;
      poll();
    }, 1500);
    const unsubscribeVisibility = onVisibilityChange(() => {
      if (isDocumentHidden()) return;
      poll();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribeVisibility();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 轮询只需跟随 running 开关，startWebFormLive 为模块级稳定引用
  }, [live?.running]);

  // 「记住这条」只在用户点过按钮后出现。每个 pending 只拉一次完整资料目录，避免后台轮询
  // 每 1.5 秒都重复请求；资料目录本身包含我的资料、网申资料和已有自定义字段。
  // 记忆弹窗锁存器：ref 记录已处理的签名，避免同一签名重复弹窗。ref 写入与
  // 状态置位在此耦合，按书面理由豁免 Compiler 规则。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const key = rememberPendingSignature;
    if (!key) {
      memoryPendingKey.current = "";
      setMemoryDialogOpen(false);
      return;
    }
    if (memoryPendingKey.current === key) return;
    memoryPendingKey.current = key;
    setMemoryDialogOpen(true);
    setMemoryTargetsLoading(true);
    void getWebFormMemoryTargets()
      .then((result) => setMemoryTargets(result.targets))
      .catch((error) => {
        message.error(error instanceof Error ? error.message : "加载完整资料目录失败");
      })
      .finally(() => setMemoryTargetsLoading(false));
  }, [message, rememberPendingSignature]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 默认开启：浏览器一旦真正可用就自动装上监听。用户明确点过「关闭」后，
  // 本次页面生命周期内不再擅自打开，避免把用户的关闭操作变成反复弹出的打扰。
  //
  // **先读状态、没开才启动**：浏览器路由已经在后端顺手开过一次（见 `api/webform/`），
  // 这里再无条件发一次 `/live/start` 不但多余，回来的旧响应还会把刚读到的"已开启"
  // 覆盖回"未开启"（用户会看到卡片先亮再灭）。
  useEffect(() => {
    if (!running || liveOptOut || aiAvailable === null || live?.running || liveStarting.current) {
      return;
    }
    liveStarting.current = true;
    void getWebFormLiveStatus()
      .then((current) => (current?.running ? current : startWebFormLive(aiOn)))
      .then((next) => {
        setLive(next ?? null);
        if (next?.running) setSessionActive(true);
      })
      .catch(() => undefined)
      .finally(() => {
        liveStarting.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 自启动只在上述五个外部输入变化时触发一次，liveStarting 守卫防重入
  }, [aiAvailable, aiOn, live?.running, liveOptOut, running]);

  // 浏览器被用户在窗口里直接关掉时，状态轮询会把本地活动标记立即收拢；
  // 关闭浏览器后复位会话状态，并回到默认开启（再次打开不用重新勾）。
  // 已读快照仍保留，重新打开浏览器后可以继续核对，不把草稿误当成已丢失。
  // Compiler 规范：随 browserState 变化的重置用渲染期守卫式调整。
  const [prevBrowserState, setPrevBrowserState] = useState(browserState);
  if (prevBrowserState !== browserState && browserState === "stopped") {
    setPrevBrowserState(browserState);
    setSessionActive(false);
    setLive(null);
    setLiveOptOut(false);
  }

  return {
    live,
    setLive,
    liveOptOut,
    setLiveOptOut,
    rememberPending,
    memoryTargets,
    memoryTargetsLoading,
    memorySaving,
    setMemorySaving,
    memoryDialogOpen,
    setMemoryDialogOpen,
  };
}
