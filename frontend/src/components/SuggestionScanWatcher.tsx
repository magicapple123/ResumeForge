/**
 * 岗位优化建议的全局提醒：用户关掉建议弹窗后，进度与结果由它接住。
 *
 * 与 `RiskScanWatcher` 同构（同一套理由）：store 里的请求在弹窗卸载后仍在跑，但如果
 * 没有任何界面接住它，用户只会看到"点了开始生成，什么都没有"。
 *
 * - 生成中且弹窗没开着 → 常驻通知（带「取消」）；
 * - 完成且弹窗没开着 → 成功通知（4 秒），告诉用户回哪里看；
 * - 失败且弹窗没开着 → 错误通知；
 * - 弹窗开着（`isSuggestionPanelAttached`）→ 关掉对应通知，避免重复提示。
 *
 * 通知 key 固定为 `suggestion-<id>`：同一份简历的同一种状态只会有一张卡片，重复 open 是
 * 更新而不是叠加。
 */
import { App, Button } from "antd";
import { useCallback, useEffect, useRef } from "react";
import {
  cancelSuggestionScan,
  isSuggestionPanelAttached,
  useSuggestionScanEntries,
} from "../features/resume/suggestionScanStore";

/** 通知 key：固定前缀，附着/结束时按同一个 key 销毁。 */
function suggestionNotificationKey(resumeId: number): string {
  return `suggestion-${resumeId}`;
}

export default function SuggestionScanWatcher() {
  const { notification } = App.useApp();
  const entries = useSuggestionScanEntries();
  // 已经提示过的「状态令牌」：避免同一份简历的完成通知被后续无关的状态变化重复触发
  // （例如另一份简历开始生成时 store 会 emit 一次，那不该让旧的成功卡片再弹一遍）。
  const handled = useRef(new Map<number, string>());

  const cancel = useCallback((resumeId: number) => {
    cancelSuggestionScan(resumeId);
  }, []);

  useEffect(() => {
    const seen = handled.current;
    for (const { resumeId, state } of entries) {
      const key = suggestionNotificationKey(resumeId);
      const token = `${state.status}:${state.finishedAt ?? state.startedAt ?? 0}`;
      if (isSuggestionPanelAttached(resumeId)) {
        // 弹窗正开着：进度/结果就地展示，全局卡片必须收掉。
        notification.destroy(key);
        if (state.status === "scanning") {
          // 进行中不记令牌：用户这时关掉弹窗，仍应收到"后台继续"的常驻卡片。
          seen.delete(resumeId);
        } else {
          // 完成/失败已经就地看过了，关掉弹窗后不必再弹一张重复的卡片。
          seen.set(resumeId, token);
        }
        continue;
      }
      if (seen.get(resumeId) === token) continue;
      seen.set(resumeId, token);

      if (state.status === "scanning") {
        notification.open({
          key,
          title: "岗位优化建议生成中",
          description: "可以离开此页面，生成会在后台继续",
          duration: 0,
          actions: (
            <Button size="small" onClick={() => cancel(resumeId)}>
              取消
            </Button>
          ),
        });
      } else if (state.status === "done") {
        notification.success({
          key,
          title: "岗位优化建议已生成",
          description: "回到简历详情点「查看岗位优化建议」即可看到。",
          duration: 4,
        });
      } else if (state.status === "error") {
        notification.error({
          key,
          title: "岗位优化建议生成失败",
          description: state.error || "可以回到简历详情重新生成。",
          duration: 5,
        });
      } else {
        // idle（含用户取消）：把卡片收掉，别留一张"进行中"骗人。
        notification.destroy(key);
      }
    }
  }, [entries, notification, cancel]);

  return null;
}
