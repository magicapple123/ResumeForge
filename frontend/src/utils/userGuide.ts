// SPDX-License-Identifier: Apache-2.0
/** 首次使用引导只保存在当前浏览器，不写入后端或用户业务数据。 */
export const USER_GUIDE_STORAGE_KEY = "resumeforge.user-guide.seen";

/**
 * 在线体验模式下不自动弹引导。
 *
 * 演示实例是嵌在官网里的，访客是被官网的步骤引导带着看的；此时再叠一层
 * 本站的向导弹窗，既盖住演示内容，又和官网的引导重复。注意只关掉**自动弹出**，
 * 侧栏的「使用指南」按钮仍然可用——访客想看随时能看。
 */
function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === "1";
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    // 隐私模式或浏览器策略可能禁用 localStorage；此时仍允许本次会话展示引导。
    return undefined;
  }
}

export function shouldShowUserGuide(
  storage: StorageLike | undefined = getBrowserStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(USER_GUIDE_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markUserGuideSeen(storage: StorageLike | undefined = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(USER_GUIDE_STORAGE_KEY, "1");
  } catch {
    // 引导本身不应因为浏览器存储不可用而阻塞应用。
  }
}

/** 原子地消费首次访问标记，避免 React StrictMode 重复 effect 导致状态反复切换。 */
export function consumeFirstVisitGuide(
  storage: StorageLike | undefined = getBrowserStorage(),
): boolean {
  if (isDemoMode()) {
    // 也把标记写上：访客之后下载完整版、在同一浏览器打开时不该再被弹一次
    // 他自己在演示站里已经看过的指南——演示站和完整版同源的情况下会共用这份存储。
    markUserGuideSeen(storage);
    return false;
  }
  if (!shouldShowUserGuide(storage)) return false;
  markUserGuideSeen(storage);
  return true;
}

/* ── 启动弹窗队列（UP-01 / 7.3） ─────────────────────────────
 *
 * 启动时最多有三件弹窗：欢迎引导、首页「近期提醒」、发现新版本。它们由三棵互不相识
 * 的组件树各自决定要不要弹，此前用两套互不知情的机制排队（更新弹窗等
 * `onceUserGuideClosed`，「近期提醒」自己读 `isUserGuideVisible`），于是更新弹窗和
 * 提醒弹窗会叠在一起。
 *
 * 现在统一走这一条有序队列：**欢迎 → 提醒 → 更新**，同一时刻只有一个槽位被占用。
 *
 * 为什么顺序是这个：前两件错过就没有意义（首次引导、逾期提醒），更新可以推迟。
 *
 * 兜底：槽位被占用后 10 分钟自动释放（某件弹窗因异常没关，后面两件不能永远不出现）。
 * 释放是幂等的，调用点可以在"关闭事件"与"卸载"两处都释放。
 */

export type StartupSlotName = "welcome" | "reminder" | "update";

/** 固定优先级：数组下标越小越先出现。 */
const SLOT_ORDER: readonly StartupSlotName[] = ["welcome", "reminder", "update"];

/**
 * 槽位最长占用时间。取 10 分钟：足够读完一份很长的发布说明，又不会让后面的弹窗
 * 在本次会话里永远不出现。
 */
export const STARTUP_SLOT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 低优先级槽位在获批前的静默期：提醒弹窗要不要弹取决于接口什么时候回来，更新弹窗
 * 1.5s 后就开始问。留 1.5s 让仍在加载的提醒先登记，否则会反过来越过顺序。
 */
const LOWER_SLOT_SETTLE_MS = 1500;

interface SlotWaiter {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}

let activeSlot: StartupSlotName | null = null;
const waiting = new Map<StartupSlotName, SlotWaiter>();
let guardTimer: number | undefined;
let settleTimer: number | undefined;

function rankOf(name: StartupSlotName): number {
  const index = SLOT_ORDER.indexOf(name);
  return index === -1 ? SLOT_ORDER.length : index;
}

function earliestWaiter(): StartupSlotName | null {
  let best: StartupSlotName | null = null;
  for (const name of waiting.keys()) {
    if (best === null || rankOf(name) < rankOf(best)) best = name;
  }
  return best;
}

function clearGuard(): void {
  if (guardTimer !== undefined) {
    window.clearTimeout(guardTimer);
    guardTimer = undefined;
  }
}

function armGuard(name: StartupSlotName): void {
  clearGuard();
  guardTimer = window.setTimeout(() => {
    guardTimer = undefined;
    releaseStartupSlot(name);
  }, STARTUP_SLOT_TIMEOUT_MS);
}

function pump(): void {
  if (activeSlot !== null) return;
  const next = earliestWaiter();
  if (next === null) return;
  const waiter = waiting.get(next);
  if (!waiter) return;

  // 「更新」排最后：先静默一拍，给仍在加载数据的提醒弹窗登记的机会。
  if (rankOf(next) > 1 && !waiter.settled) {
    waiter.settled = true;
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      pump();
    }, LOWER_SLOT_SETTLE_MS);
    return;
  }

  waiting.delete(next);
  activeSlot = next;
  armGuard(next);
  waiter.resolve();
}

/** 申请一个启动弹窗槽位。轮到它时 promise 才 resolve；重复申请返回同一个 promise。 */
export function acquireStartupSlot(name: StartupSlotName): Promise<void> {
  if (activeSlot === name) return Promise.resolve();
  const existing = waiting.get(name);
  if (existing) return existing.promise;

  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  waiting.set(name, { promise, resolve, settled: false });
  pump();
  return promise;
}

/**
 * 释放槽位：正在占用就交给下一个；还在排队就撤销申请（调用方已取消）。
 * 幂等——关窗事件与组件卸载各调一次是安全的。
 */
export function releaseStartupSlot(name: StartupSlotName): void {
  const wasWaiting = waiting.delete(name);
  if (activeSlot !== name) {
    if (wasWaiting) pump();
    return;
  }
  activeSlot = null;
  clearGuard();
  pump();
}

/* ── 欢迎引导：既是启动弹窗的第一件，也承担"引导开着"这个状态 ── */

let userGuideVisible = false;

/**
 * 引导开关状态变化时调用（由 App 布局同步）。
 *
 * 打开时直接占住最高优先级槽位：欢迎引导 0s 就出现，队列里排在它后面的提醒/更新
 * 自然等它关掉。若打开时已有别的槽位在占用（用户在更新弹窗里手动点开了使用指南），
 * 不抢占、也不改变那条链——两者各自是独立窗口，强行接管反而会让释放对不上。
 */
export function setUserGuideVisible(visible: boolean): void {
  const was = userGuideVisible;
  userGuideVisible = visible;
  if (visible && !was) {
    if (activeSlot === null) {
      activeSlot = "welcome";
      armGuard("welcome");
    }
    return;
  }
  if (!visible && was && activeSlot === "welcome") {
    activeSlot = null;
    clearGuard();
    pump();
  }
}
