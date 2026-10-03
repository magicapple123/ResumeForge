/**
 * 职责①：把「这次读取」记进 URL，并在回到本页时按 URL 重放一次预览。
 * （自 WebFormPage 拆出：restoring state、rememberSnapshot/forgetSnapshot、restore effect
 * 原样搬运；useSearchParams 仅由页面组件体内调用（本 hook 在页面组件体内执行），
 * Router 上下文与现状一致。）
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { App } from "antd";
import { previewWebForm } from "../../api/webform";
import type { WebFormPreview, WebFormSnapshot } from "../../types";
import type { WebFormBusyState } from "./constants";
import { AI_PARAM, SNAPSHOT_PARAM } from "./constants";

export function useSnapshotUrl({
  aiAvailable,
  restoredSessionPreview,
  applyPreview,
  setSnapshot,
  setBusy,
  message,
}: {
  aiAvailable: boolean | null;
  restoredSessionPreview: WebFormPreview | null;
  applyPreview: (report: WebFormPreview) => void;
  setSnapshot: (snapshot: WebFormSnapshot | null) => void;
  setBusy: (busy: WebFormBusyState) => void;
  message: ReturnType<typeof App.useApp>["message"];
}): {
  snapshotId: string | null;
  rememberSnapshot: (snapshotId: string, ai: boolean) => void;
  forgetSnapshot: () => void;
  setRestoring: (restoring: boolean) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  // 当前这次读取记在 URL 里（见页面文件头的说明）。`replace` 写回，不堆历史。
  // 挂载时从 URL 恢复用的一次性标记：只自动重放一次，之后由用户自己点「读取」。
  const [restoring, setRestoring] = useState(() =>
    Boolean(searchParams.get(SNAPSHOT_PARAM) && !restoredSessionPreview),
  );

  /** 把这次读取记进 URL。**`replace`**：读一次不该往历史里塞一条。 */
  const rememberSnapshot = useCallback(
    (snapshotId: string, ai: boolean) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(SNAPSHOT_PARAM, snapshotId);
          next.set(AI_PARAM, ai ? "1" : "0");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** 忘掉这次读取（填完了、关浏览器了、或后端说它过期了）。 */
  const forgetSnapshot = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(SNAPSHOT_PARAM);
        next.delete(AI_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /**
   * 回到本页时按 URL 里的 `snapshot_id` 重放一次预览。
   *
   * 后端的预览是**纯计算**（快照 + 资料），所以重放出来的与当初读到的一致（资料没变的话）。
   * 快照有 15 分钟 TTL——过期时后端会抛「这次读取的表单已经过期，请重新点「读取当前表单」」，
   * 这里**原样转述那句话**（不另编一句，否则同一件事有两个说法），并清掉 URL 参数，
   * 而不是静默留一个空页面。
   *
   * AI 开关按当初那次的值重放，否则"读的时候开了 AI、回来却重算成规则版"，
   * 用户会以为结果变了。
   */
  useEffect(() => {
    if (!restoring) return;
    const snapshotId = searchParams.get(SNAPSHOT_PARAM);
    if (!snapshotId) {
      setRestoring(false);
      return;
    }
    // AI 要不要用，等模型配置读回来再定——否则 `aiOn` 还是 false，会重放成规则版。
    if (aiAvailable === null) return;

    let cancelled = false;
    const restore = async () => {
      const aiWas = searchParams.get(AI_PARAM) === "1";
      setBusy("read");
      try {
        const report = await previewWebForm(snapshotId, aiWas && aiAvailable);
        if (cancelled) return;
        setSnapshot({ snapshot_id: snapshotId, page: report.page });
        applyPreview(report);
        message.info("已恢复上次读取的表单；勾选已重置为默认，请核对后再填充");
      } catch (error) {
        if (cancelled) return;
        forgetSnapshot();
        message.warning(
          error instanceof Error ? error.message : "上次读取的表单已失效，请重新读取",
        );
      } finally {
        if (!cancelled) {
          setBusy(null);
          setRestoring(false);
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
    // 只在挂载时按 URL 重放一次；`restoring` 落下后就不再触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoring, aiAvailable]);

  return {
    snapshotId: searchParams.get(SNAPSHOT_PARAM),
    rememberSnapshot,
    forgetSnapshot,
    setRestoring,
  };
}
