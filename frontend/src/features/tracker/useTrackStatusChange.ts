// SPDX-License-Identifier: Apache-2.0
/**
 * 进度状态就地改（整改 #15）：`PATCH /tracker/{id}/status` + 5 秒撤销。
 *
 * ## 为什么不是"读出来改一个字段再 PUT"
 *
 * `PUT /tracker/{id}` 是**整份替换**（`TrackUpdate` 继承 `TrackCreate`），要求
 * job_id / resume_id / channel / link / applied_at 全量回传：既容易撞上"内部/外部简历
 * 只能二选一"的互斥校验，也会用前端手里的旧快照覆盖别人刚改的备注。专端点只碰 status。
 *
 * ## 撤销 = 再 PATCH 一次改回去
 *
 * **不是**删掉刚才那条事件。时间线记录的是"真实发生过的变化"，「改过去」与「改回来」
 * 都是发生过的事，留两条才是真实历史——用户回看时能看出"这里来回过"。
 *
 * ## 连点防护
 *
 * `pendingId` 只驱动 UI（该行胶囊半透明 + 不响应点击），真正挡住"两次提交"的是
 * `inFlight` 这个 ref：state 更新是异步的，双击时第二次点击读到的往往还是旧 state。
 * 同一行连点两次会写两条事件、把时间线弄脏。
 */
import { useCallback, useRef, useState } from "react";
import { patchTrackStatus } from "../../api/tracker";
import { t } from "../../i18n";
import { TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import { useToast } from "../../hooks/useToast";
import type { Track, TrackStatus } from "../../types";

export interface TrackStatusChangeApi {
  /** 正在提交的行 id（`null` = 没有进行中的提交）。该行的胶囊进 pending 态。 */
  pendingId: number | null;
  /** 把某条进度改成 `next`；成功即刷新列表与漏斗，并给一个 5 秒撤销。 */
  change: (track: Track, next: TrackStatus) => Promise<void>;
}

export interface TrackStatusChangeOptions {
  /** 改完之后统一失效重拉：列表与顶部构成条要一起刷新，否则数字停在旧值。 */
  onChanged: () => void | Promise<void>;
}

export function useTrackStatusChange({ onChanged }: TrackStatusChangeOptions): TrackStatusChangeApi {
  const toast = useToast();
  const [pendingId, setPendingId] = useState<number | null>(null);
  // 同步的"在飞行中"标记：state 异步，挡不住双击。
  // 用「行 id 集合」而不是一个布尔量：A 行请求还没回来时，用户去改 B 行是合法操作，
  // 只有一个布尔量会把 B 行也一起挡掉。
  const inFlight = useRef<Set<number>>(new Set());

  const change = useCallback(
    async (track: Track, next: TrackStatus) => {
      // 同状态是幂等的（后端不写事件），前端也不必发这一趟。
      if (next === track.status) return;
      // 这一行已经在提交中：连点不写第二条事件（时间线会被弄脏）。
      if (inFlight.current.has(track.id)) return;
      inFlight.current.add(track.id);
      setPendingId(track.id);
      try {
        await patchTrackStatus(track.id, next);
        await onChanged();
        toast.undo(
          t("trackerUi.card.statusChanged", { status: t(TRACK_STATUS_LABEL_KEYS[next]) }),
          {
            label: t("toast.undo.label"),
            onClick: async () => {
              try {
                await patchTrackStatus(track.id, track.status);
                await onChanged();
                toast.success(
                  t("trackerUi.card.statusChanged", {
                    status: t(TRACK_STATUS_LABEL_KEYS[track.status]),
                  }),
                );
              } catch {
                // 撤销失败要说清楚（这条记录现在停在新状态），不要静默吞掉。
                toast.error(t("trackerUi.card.statusChangeFailed"));
              }
            },
          },
          // 同一行连续改只留一张卡：key 绑在行 id 上（连点两格不会叠两层 toast）。
          { key: `track-status-${track.id}` },
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("trackerUi.card.statusChangeFailed"),
        );
      } finally {
        inFlight.current.delete(track.id);
        // 只清自己那一行的 pending：另一行还在飞时不要把它的反馈也抹掉。
        setPendingId((current) => (current === track.id ? null : current));
      }
    },
    [onChanged, toast],
  );

  return { pendingId, change };
}
