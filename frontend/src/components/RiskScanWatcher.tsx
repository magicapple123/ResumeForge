// SPDX-License-Identifier: Apache-2.0
/**
 * 风险扫描的全局提醒：用户在扫描期间离开「质量检测」弹窗时，把进度/结果接住。
 *
 * 为什么要在布局层再放一个组件：面板卸载后 store 里的请求仍在跑（那是刻意的），但如果
 * 没有任何界面接住它，用户只会看到"点了开始扫描，什么都没有"。这里订阅**所有**简历的
 * 扫描槽：
 * - 扫描中且面板没开着 → 常驻通知（带「取消」）：明确告诉他可以继续干别的；
 * - 完成且面板没开着 → 成功通知（4 秒），点不开窗也不会错过结果；
 * - 失败且面板没开着 → 错误通知；
 * - 面板开着（`isRiskPanelAttached`）→ 关掉对应通知，避免"面板上已经在显示结果，
 *   右上角又弹一张卡片"。
 *
 * 通知的 key 固定为 `risk-<id>`：同一份简历的同一种状态只会有一张卡片，重复 open 是更新
 * 而不是叠加。
 */
import { App, Button } from "antd";
import { useCallback, useEffect, useRef } from "react";
import {
  cancelRiskScan,
  isRiskPanelAttached,
  useRiskScanEntries,
} from "../features/resume/riskScanStore";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** 通知 key：固定前缀，附着/结束时按同一个 key 销毁。 */
function riskNotificationKey(resumeId: number): string {
  return `risk-${resumeId}`;
}

export default function RiskScanWatcher() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这块文案不重渲染。
  useLocale();
  const { notification } = App.useApp();
  const entries = useRiskScanEntries();
  // 已经提示过的「状态令牌」：避免同一份简历的完成通知被后续无关的状态变化重复触发
  // （例如另一份简历开始扫描时 store 会 emit 一次，那不该让旧的成功卡片再弹一遍）。
  const handled = useRef(new Map<number, string>());

  const cancel = useCallback((resumeId: number) => {
    cancelRiskScan(resumeId);
  }, []);

  useEffect(() => {
    const seen = handled.current;
    for (const { resumeId, state } of entries) {
      const key = riskNotificationKey(resumeId);
      const token = `${state.status}:${state.finishedAt ?? state.startedAt ?? 0}`;
      if (isRiskPanelAttached(resumeId)) {
        // 面板正开着：进度/结果就地展示，全局卡片必须收掉。
        notification.destroy(key);
        if (state.status === "scanning") {
          // 进行中不记令牌：用户这时关掉面板，仍应收到"后台继续"的常驻卡片。
          seen.delete(resumeId);
        } else {
          // 完成/失败已经就地看过了，关掉面板后不必再弹一张重复的卡片。
          seen.set(resumeId, token);
        }
        continue;
      }
      if (seen.get(resumeId) === token) continue;
      seen.set(resumeId, token);

      if (state.status === "scanning") {
        notification.open({
          key,
          title: t("backgroundTasks.risk.running.title"),
          description: t("backgroundTasks.risk.running.description"),
          duration: 0,
          actions: (
            <Button size="small" onClick={() => cancel(resumeId)}>
              {t("backgroundTasks.action.cancel")}
            </Button>
          ),
        });
      } else if (state.status === "done") {
        const total = state.result?.points.length ?? 0;
        notification.success({
          key,
          title: t("backgroundTasks.risk.done.title"),
          description: t("backgroundTasks.risk.done.description", { count: total }),
          duration: 4,
        });
      } else if (state.status === "error") {
        notification.error({
          key,
          title: t("backgroundTasks.risk.failed.title"),
          description: state.error || t("backgroundTasks.risk.failed.description"),
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
