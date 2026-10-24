// SPDX-License-Identifier: Apache-2.0
/**
 * 内置字体下载的**共享状态机**：设置页那一行（`BuiltinFontRow`）与制作台的字体下拉
 * （`ResumeFontControl`）共用同一份，本批起不再有第二份轮询。
 *
 * ## 为什么必须只有一个
 *
 * 轮询漏清 = 关掉界面还在打接口；两处各写一份 = 迟早有一处漏清、或者两处的
 * "下载完成后做什么"漂成两种行为。所以定时器、`pending`（本次点击触发的那一轮）、
 * 409 接续、取消、删除全部收在这里；**策略**（下完之后要不要接管全局字体 / 要不要写成
 * 这份简历的字体）通过 `onDownloaded` 交回宿主。
 *
 * ## 三条口径（与 `api/fonts.ts` 的文件头一致）
 *
 * 1. `state` 是唯一状态源；`cancelling` 只是提示位，任何分支都不得当独立状态用。
 * 2. 轮询**只在 `downloading` 期间存在**（500ms），离开即清定时器。
 * 3. `onDownloaded` 只对**本次点击触发的下载**回调一次——"每次挂载都接管一遍"会把用户
 *    后来手动换掉的字体默默改回来，属于"我明明选了字体"。
 *
 * ## 失败面
 *
 * - `start` 的 409（已在下载）**不算失败**：把进度接上（读一次状态）、提示一句、不重复 POST；
 * - 其它启动失败（507 磁盘满等）落到 `startError`，由宿主在**行内**给出原因 + 重试；
 * - 取消 / 删除失败用 `message.error` 就地透出（这两处宿主没有"行内失败态"的位置）。
 */
import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  cancelBuiltinFontDownload,
  deleteBuiltinFont,
  getBuiltinFont,
  startBuiltinFontDownload,
  type BuiltinFontStatus,
} from "../../api/fonts";
import { t } from "../../i18n";

/** 轮询间隔：后端按块写文件，500ms 足以让进度看起来连续，又不会把界面打成刷屏。 */
export const BUILTIN_POLL_INTERVAL_MS = 500;

/** 删除的结果：`missing` = 本来就没下载（幂等视角等于"已经没有了"，不必报错）。 */
export type RemoveOutcome = "removed" | "missing" | "failed";

interface Options {
  /**
   * 宿主手上已有的状态快照（设置页由父组件传下来那份）。
   *
   * 传了它就不需要本 hook 再去读一次（那是同一个数），所以有 `initial` 时**一个请求都不多打**。
   */
  initial?: BuiltinFontStatus | null;
  /**
   * `true` = 状态读取完全由宿主掌握（宿主在合适的时机调 `refresh()`），挂载时不读。
   *
   * 缺省 `false` = "开箱即用"：没有 `initial` 时挂载读一次，界面立刻能显示
   * 「未下载 / 已下载」。**制作台必须传 `true`**：那一格会被参数栏反复渲染，而
   * 「拖动字号滑杆全程零网络」是既有契约（`ResumeLayoutControls.font.test.tsx` 钉着它）。
   */
  manual?: boolean;
  /**
   * 下载完成后是否让**后端**接管全局当前字体。缺省 `true`（设置页）。
   * 制作台传 `false`：那里下载完要写成**这一份简历**的字体，改全局设置是另一件事。
   */
  activate?: boolean;
  /** 本轮点击触发的下载刚走到 `done`：只回调一次。 */
  onDownloaded?: (status: BuiltinFontStatus) => void | Promise<void>;
  /** 状态确实变了（下载完成 / 取消后回到 idle / 删除成功）→ 请宿主重拉字体清单。 */
  onChanged?: () => void;
}

export interface BuiltinFontDownload {
  status: BuiltinFontStatus | null;
  state: "idle" | "downloading" | "failed" | "done";
  downloading: boolean;
  /** 取消信号已发出、后端在收尾（提示位，不是独立状态）。 */
  cancelling: boolean;
  downloaded: boolean;
  /** 启动失败的原因（409 / 507 等）；空串 = 没有。宿主用它渲染行内失败态。 */
  startError: string;
  /** 取消 / 删除请求在飞（按钮 loading）。 */
  busy: boolean;
  /** 主动读一次状态（宿主决定时机：设置页靠 `initial`，制作台在下拉展开时调）。 */
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  remove: () => Promise<RemoveOutcome>;
}

/** 删除成功后用的"已回到未下载"快照：体积等静态字段沿用上一份，避免多打一次接口。 */
function idleSnapshot(previous: BuiltinFontStatus | null): BuiltinFontStatus | null {
  if (!previous) return null;
  return {
    ...previous,
    downloaded: false,
    downloaded_bytes: 0,
    state: "idle",
    error: "",
    cancelling: false,
  };
}

export function useBuiltinFontDownload(options: Options = {}): BuiltinFontDownload {
  const { initial, manual = false, activate = true, onDownloaded, onChanged } = options;
  const { message } = App.useApp();
  /**
   * 本地覆盖值：读到的 / 启动返回的状态放这里，`override ?? initial` 就是当前值。
   * 不把轮询结果回写给父组件：父组件重拉的是字体清单，与"那个大文件下到哪了"不是一件事。
   */
  const [override, setOverride] = useState<BuiltinFontStatus | null>(null);
  const [startError, setStartError] = useState("");
  const [busy, setBusy] = useState(false);
  /** 本次下载是否还要走 `onDownloaded`。只有用户点了「下载」/「重试」才置 true。 */
  const pendingRef = useRef(false);
  /**
   * 回调放 ref：宿主每次渲染都会传一个新的箭头函数，如果进依赖数组，轮询定时器会被
   * 反复销毁重建（一秒钟重建几十次）。写入放 effect，符合本仓库的 Compiler 规则。
   */
  const callbacksRef = useRef({ onDownloaded, onChanged });
  useEffect(() => {
    callbacksRef.current = { onDownloaded, onChanged };
  });

  const current = override ?? initial ?? null;
  const state = current?.state ?? "idle";
  const downloading = state === "downloading";
  const cancelling = Boolean(current?.cancelling);
  const downloaded = state === "done" || Boolean(current?.downloaded);

  /**
   * 主动读一次状态（宿主决定时机时用；见 `manual` 选项）。
   *
   * 读不到（老后端没有这个接口 / 网络抖动）时静默：这是可选能力，不影响界面其余部分。
   */
  const refresh = useCallback(async () => {
    try {
      setOverride(await getBuiltinFont());
    } catch {
      // 见 docstring：不弹错、不阻塞。
    }
  }, []);

  /**
   * 挂载时读一次——**只在"开箱即用"的用法下**：宿主没给 `initial`（没有更便宜的来源）
   * 且没把读取权收回去（`manual` 为假）。
   *
   * 制作台必须关掉它：那一格会被参数栏反复渲染，而「拖动字号滑杆全程零网络」是既有
   * 契约（`ResumeLayoutControls.font.test.tsx` 钉着它）。
   */
  const autoRead = !manual && initial === undefined;
  useEffect(() => {
    if (!autoRead) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const next = await getBuiltinFont();
        if (!cancelled) setOverride(next);
      } catch {
        // 见上：可选能力，不弹错。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoRead]);

  // 轮询只在下载中存续：`clearInterval` 在清理函数里，卸载/取消/切走都会停。
  // **停止轮询的唯一条件是 `state` 不再是 `downloading`**——也就是**已经看到 done 的那
  // 一次 GET 之后**（那一拍请求本身就是"确认完成"，绝不按进度百分比提前收手）。
  useEffect(() => {
    if (state !== "downloading") return undefined;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getBuiltinFont();
          if (cancelled) return;
          setOverride(next);
          if (next.state === "done" && pendingRef.current) {
            pendingRef.current = false;
            await callbacksRef.current.onDownloaded?.(next);
          }
        } catch {
          // 偶发失败不打断下载：状态与进度原地不动，下一拍再读。
        }
      })();
    }, BUILTIN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state]);

  /** 启动下载（也用于失败后的「重试」：两条路径完全同一件事）。 */
  const start = useCallback(async () => {
    setStartError("");
    pendingRef.current = true;
    try {
      // `activate === true` 时**不带**查询参数：设置页的行为与今天逐字一致。
      const next = await startBuiltinFontDownload(activate ? {} : { activate: false });
      setOverride(next);
    } catch (error) {
      pendingRef.current = false;
      if (error instanceof ApiError && error.status === 409) {
        // 已在下载（另一个窗口点的，或上一次点击的响应丢了）：把进度接上、不重复提交，
        // 也不弹错——用户此刻要看的是进度条，不是一句他无法处理的报错。
        message.info(t("fontDownload.alreadyDownloading"));
        try {
          setOverride(await getBuiltinFont());
        } catch {
          // 读不到就保持原样：下一拍不会自己来（状态还不是 downloading），但也不该抛。
        }
        return;
      }
      // 裸 Error 的 message 就是后端那句人话（`ApiError` 继承 Error），原样给用户看。
      setStartError(error instanceof Error ? error.message : "");
    }
  }, [activate, message]);

  /** 取消这一轮下载。幂等：后端没有下载在跑时原样返回当前状态。 */
  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      const next = await cancelBuiltinFontDownload();
      pendingRef.current = false;
      setOverride(next);
      if (next.state === "done") {
        // 取消与完成撞车，后端"以完成为准"：文件保住了，清单要刷新（**不**走
        // `onDownloaded`——用户刚点了取消，此刻替他把字体设上会像"没听他的"）。
        callbacksRef.current.onChanged?.();
      }
    } catch (error) {
      message.error(
        t("fontDownload.cancelFailed", {
          error: error instanceof Error ? error.message : "",
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [message]);

  /** 删除已下载的两个字面。`404` 当成功（幂等）；其余失败弹原因、文件原样留着。 */
  const remove = useCallback(async (): Promise<RemoveOutcome> => {
    setBusy(true);
    try {
      await deleteBuiltinFont();
      pendingRef.current = false;
      setOverride((previous) => idleSnapshot(previous ?? initial ?? null));
      callbacksRef.current.onChanged?.();
      return "removed";
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // 本来就没下载：视角上等于"已经没有了"，刷新清单就行，不必报错。
        setOverride((previous) => idleSnapshot(previous ?? initial ?? null));
        callbacksRef.current.onChanged?.();
        return "missing";
      }
      message.error(
        t("fontDownload.deleteFailed", {
          error: error instanceof Error ? error.message : "",
        }),
      );
      return "failed";
    } finally {
      setBusy(false);
    }
  }, [initial, message]);

  return {
    status: current,
    state,
    downloading,
    cancelling,
    downloaded,
    startError,
    busy,
    refresh,
    start,
    cancel,
    remove,
  };
}
