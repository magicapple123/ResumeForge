// SPDX-License-Identifier: Apache-2.0
/**
 * 投投的**实时信号**（#27B）：把"现在这一页有什么问题"从各处数据源收敛成
 * `TouTouSignal[]`，供球 pulse、气泡出文案。
 *
 * 四类信号与数据源：
 * - `layout-overflow`：**与 #24 共用同一次本地测量**——直接读
 *   `useWorkbenchLayoutSnapshot()` 那一份快照（画布量完写进 store，左栏状态条也读它），
 *   这里不再自己量一遍 iframe；
 * - `resume-unsaved`：`profileSaveBridge` 的保存槽（页面在表单变脏时 set）；
 * - `queue-unsupported`：仅在 `/apply` 页读一次队列（只读接口，失败静默）；
 * - `profile-missing-fields`：仅在 `/profile` 页读一次资料，按关键字段本地计数。
 *
 * 后两类只在**对应路由**上取数：球是全局的，不该在每页都去问队列/资料。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { listQueue } from "../../api/apply";
import { getProfile } from "../../api/profile";
import { useWorkbenchLayoutSnapshot } from "../../components/resume/workbenchLayoutStore";
import type { WorkbenchLayoutSnapshot } from "../../components/resume/workbenchLayoutStore";
import { pagesNeededFor } from "../../utils/resumeLayoutMeasure";
import {
  getProfileSaveControl,
  subscribeProfileSaveControl,
  type ProfileSaveControl,
} from "./profileSaveBridge";
import type { TouTouSignal } from "./touTouPageContext";
import { mergeTouTouPageContexts } from "./touTouPageContext";
import { useTouTouPageContext } from "./useTouTouPageContext";

/** 资料"关键字段"清单：缺了它们投递/生成都会卡。顺序即提示里的优先级。 */
const KEY_PROFILE_FIELDS = ["name", "phone", "email", "job_intent"] as const;

/** 资料缺几项关键信息（纯函数：资料页的信号与测试共用）。 */
export function countMissingProfileFields(profile: {
  name: string;
  phone: string;
  email: string;
  job_intent: string;
  educations: readonly unknown[];
  experiences: readonly unknown[];
}): number {
  let missing = 0;
  for (const field of KEY_PROFILE_FIELDS) {
    if (!String(profile[field] ?? "").trim()) missing += 1;
  }
  if (profile.educations.length === 0) missing += 1;
  if (profile.experiences.length === 0) missing += 1;
  return missing;
}

/**
 * 队列里来源不支持自动投递的条数（纯函数）。
 *
 * 判据是 `apply_supported === false`（与投递台本身同一条字段；缺失按支持处理，
 * 不能写 `!item.apply_supported`——那会把"旧后端缺字段"误算成不支持）。
 */
export function countUnsupportedQueueSources(
  items: readonly { apply_supported?: boolean }[],
): number {
  return items.filter((item) => item.apply_supported === false).length;
}

export interface TouTouSignalSources {
  saveControl: ProfileSaveControl | null;
  workbench: WorkbenchLayoutSnapshot;
  queueUnsupported: number;
  profileMissing: number;
  /** 页面自己登记的信号；同 id 覆盖内置来源。 */
  registered: readonly TouTouSignal[];
}

/**
 * 合成当前信号列表（纯函数，全部输入显式传入）。
 *
 * 同一类信号最多一条：测量每次重排都会重算，若不按 kind 折叠，拖一次滑杆就会叠出
 * 十几条一样的信号。
 */
export function deriveTouTouSignals(sources: TouTouSignalSources): readonly TouTouSignal[] {
  const live: TouTouSignal[] = [];
  if (sources.saveControl) {
    live.push({
      id: "resume-unsaved",
      kind: "resume-unsaved",
      messageKey: "touTou.signal.resumeUnsaved.title",
      // 保存卡已经在球旁边常驻，再出一条气泡只是噪音：只 pulse。
      announce: false,
    });
  }
  const { measure, layoutStatus } = sources.workbench;
  if (measure) {
    const needed = layoutStatus?.pagesNeeded ?? pagesNeededFor(measure);
    const overflow = Boolean(layoutStatus?.overflow) || needed > measure.pageLimit;
    if (overflow) {
      live.push({
        id: "layout-overflow",
        kind: "layout-overflow",
        count: needed,
        messageKey: "touTou.signal.layoutOverflow.title",
        params: { needed, limit: measure.pageLimit },
      });
    }
  }
  if (sources.queueUnsupported > 0) {
    live.push({
      id: "queue-unsupported",
      kind: "queue-unsupported",
      count: sources.queueUnsupported,
      messageKey: "touTou.signal.queueUnsupported.title",
      params: { count: sources.queueUnsupported },
      actionId: "go-apply",
    });
  }
  if (sources.profileMissing > 0) {
    live.push({
      id: "profile-missing-fields",
      kind: "profile-missing-fields",
      count: sources.profileMissing,
      messageKey: "touTou.signal.profileMissing.title",
      params: { count: sources.profileMissing },
      actionId: "go-profile",
    });
  }
  return mergeTouTouPageContexts([{ signals: live }, { signals: sources.registered }]).signals;
}

async function loadQueueUnsupportedCount(): Promise<number> {
  const data = await listQueue();
  return countUnsupportedQueueSources(data.items);
}

async function loadProfileMissingCount(): Promise<number> {
  return countMissingProfileFields(await getProfile());
}

/** 只在路由命中时取一次数；失败静默（信号少一条，界面不能因此报错）。 */
function useRouteGatedCount(active: boolean, load: () => Promise<number>): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void load()
      .then((value) => {
        if (!cancelled) setCount(value);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [active, load]);
  // 离开该路由就当作没有这条信号：清 state 会触发 set-state-in-effect，不如在派生处清。
  return active ? count : 0;
}

/** 当前页面的实时信号（含页面登记的信号）。 */
export function useTouTouSignals(): readonly TouTouSignal[] {
  const { pathname } = useLocation();
  const pageContext = useTouTouPageContext();
  const saveControl = useSyncExternalStore(subscribeProfileSaveControl, getProfileSaveControl);
  const workbench = useWorkbenchLayoutSnapshot();
  const queueUnsupported = useRouteGatedCount(pathname === "/apply", loadQueueUnsupportedCount);
  const profileMissing = useRouteGatedCount(pathname === "/profile", loadProfileMissingCount);
  const derived = deriveTouTouSignals({
    saveControl,
    workbench,
    queueUnsupported,
    profileMissing,
    registered: pageContext.signals,
  });
  return derived;
}
