// SPDX-License-Identifier: Apache-2.0
/**
 * 当前组投影（GET /api/profile/current/projection）的模块级共享缓存（F4）。
 *
 * 新建来源面板 / 编辑器「从资料追加一条」/ 生成摘要三处读同一份投影：各自 fetch 会得到
 * 三份在飞请求与三套"切组后谁是新的"判断，而「候选与 content 同源」（R-37）要求三处看到
 * **同一个** content 快照，所以只留这一份。
 *
 * 失效模型是 epoch：任何资料/组/定义/偏好写成功、切组、恢复、导入、识别保存后调用
 * invalidateProjectionCache()——epoch++、中止在飞请求、清缓存，并通知已挂载消费者重取。
 * 切数据集是整页 reload，datasetId 仍进键（页面内变化也不复用上一份数据集）。
 *
 * ## 跨窗口（F9）
 *
 * 资料页与简历页可能同时开在同一个浏览器的两个窗口/标签里：A 窗口保存资料或切组后，
 * B 窗口那份模块级缓存会一直停在旧组，表现为"新建简历的页签/候选不跟着变"。失效时额外
 * 广播一次（BroadcastChannel；不支持时退回 localStorage 的 storage 事件），收到广播的
 * 窗口只做**本地失效**（epoch++ + 通知消费者重取），不再转发，所以不会形成回环。
 *
 * 监听在第一个消费者订阅时惰性挂上、之后常驻：有缓存就说明这个窗口曾经订阅过，晚到的
 * 广播也还能命中。没有消费者时收不收都一样（下次打开会重新取）。
 *
 * 迟到响应：每次请求记下发起时的键；返回时键已变就不写缓存，并把键带回调用方二次校验。
 */
import { readActiveDatasetId } from "../../utils/datasetScope";
import { getCurrentProjection } from "./api";
import type { PaperProjectionOut } from "./types";

export interface ProjectionCacheEntry {
  /** 缓存键：`<datasetId>::<epoch>`。 */
  key: string;
  data: PaperProjectionOut;
}

interface InFlightProjection {
  key: string;
  controller: AbortController;
  consumers: number;
  promise: Promise<PaperProjectionOut>;
}

/** 跨窗口失效的频道名（BroadcastChannel）与兜底键（localStorage）。 */
const INVALIDATION_CHANNEL = "resumeforge:projection-invalidation";
const INVALIDATION_STORAGE_KEY = "resumeforge:projection-invalidation";
/** 消息类型：只表达"投影失效"这一件事，收到不认识的消息一律忽略。 */
const INVALIDATION_MESSAGE = "projection-invalidated";

let epoch = 0;
let entry: ProjectionCacheEntry | null = null;
let inFlight: InFlightProjection | null = null;
const invalidationListeners = new Set<() => void>();

/** 接收端频道（惰性创建；null = 还没创建或环境不支持）。同一实例也用来发送。 */
let remoteChannel: BroadcastChannel | null = null;
/** 跨窗口监听是否已挂上（模块级只挂一次；消费者卸载不撤销——缓存可能还在）。 */
let listeningRemoteInvalidation = false;
/** storage 兜底监听的引用（测试复位时用来 removeEventListener）。 */
let storageListener: ((event: StorageEvent) => void) | null = null;

/** 当前缓存键（datasetId + epoch）；调用方用它判断响应是否已失效。 */
export function projectionCacheKey(): string {
  return `${readActiveDatasetId()}::${epoch}`;
}

/** 同键缓存；key 不同（已失效）返回 null。 */
export function getCachedProjection(): ProjectionCacheEntry | null {
  return entry !== null && entry.key === projectionCacheKey() ? entry : null;
}

/** 只做本窗口失效：推进一代、清缓存、中止在飞请求、通知消费者。不广播（接收端复用）。 */
function invalidateLocalProjectionCache(): void {
  epoch += 1;
  entry = null;
  if (inFlight !== null) {
    inFlight.controller.abort();
    inFlight = null;
  }
  for (const listener of invalidationListeners) listener();
}

/** 通知同源其它窗口；没有跨窗口通道时退回 localStorage（storage 事件只在其它窗口触发）。 */
function postInvalidationToOtherWindows(): void {
  if (typeof window === "undefined") return;
  // BroadcastChannel 绝大多数现代浏览器都有；测试环境（jsdom）没有，正好走 storage 兜底。
  if (typeof window.BroadcastChannel === "function") {
    try {
      const channel = getRemoteChannel();
      channel?.postMessage({ type: INVALIDATION_MESSAGE });
      return;
    } catch {
      // 建频道/发送失败（隐私模式、被策略禁用）：退回 storage 兜底，还不够就只失效本窗口。
    }
  }
  try {
    // 值只要每次不同即可：storage 事件对同文档不触发，只有其它同源窗口会收到。
    window.localStorage.setItem(INVALIDATION_STORAGE_KEY, String(Date.now()));
  } catch {
    // localStorage 不可用（安全策略/容量）：广播降级失败不影响本窗口已完成的失效。
  }
}

/** 惰性创建接收/发送共用的频道；环境不支持时返回 null。 */
function getRemoteChannel(): BroadcastChannel | null {
  if (remoteChannel !== null) return remoteChannel;
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") return null;
  try {
    remoteChannel = new window.BroadcastChannel(INVALIDATION_CHANNEL);
  } catch {
    remoteChannel = null;
  }
  return remoteChannel;
}

/** 是不是本模块约定的失效消息（其它消息一律忽略）。 */
function isInvalidationMessage(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === "object" &&
    (data as { type?: unknown }).type === INVALIDATION_MESSAGE
  );
}

/**
 * 挂上跨窗口失效监听（幂等；第一个投影消费者订阅时调用）。
 *
 * 有 BroadcastChannel 就用它；没有就监听 window 的 storage 事件。两条路只选一条：
 * 同一浏览器里所有窗口的支持能力一致，混用只会收到两次。
 */
function ensureRemoteInvalidationListening(): void {
  if (listeningRemoteInvalidation || typeof window === "undefined") return;
  listeningRemoteInvalidation = true;
  const channel = getRemoteChannel();
  if (channel !== null) {
    channel.onmessage = (event: MessageEvent) => {
      if (isInvalidationMessage(event.data)) invalidateLocalProjectionCache();
    };
    return;
  }
  storageListener = (event: StorageEvent) => {
    if (event.key === INVALIDATION_STORAGE_KEY) invalidateLocalProjectionCache();
  };
  window.addEventListener("storage", storageListener);
}

/** 资料/组写成功或切组成功后调用（F6 写路径）：幂等，推进一代、中止在飞请求并广播。 */
export function invalidateProjectionCache(): void {
  invalidateLocalProjectionCache();
  postInvalidationToOtherWindows();
}

/** 订阅失效通知（useCurrentProjection 自动重取用）；返回取消订阅函数。 */
export function subscribeProjectionInvalidation(listener: () => void): () => void {
  // 订阅 = 这个窗口开始消费投影：顺手把跨窗口监听挂上（只在第一次真正做事）。
  ensureRemoteInvalidationListening();
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

/**
 * 仅测试：复位模块级状态（缓存 / 在飞请求 / 订阅者 / 跨窗口频道与监听）。
 *
 * 生产代码不要调用：这是单例 store 的用例隔离手段，与 `resetResumeListEventsForTests`
 * 同一套做法（跨用例的模块状态不重置会串味）。
 */
export function resetProjectionCacheForTests(): void {
  epoch = 0;
  entry = null;
  inFlight?.controller.abort();
  inFlight = null;
  invalidationListeners.clear();
  if (remoteChannel !== null) {
    remoteChannel.onmessage = null;
    remoteChannel.close();
    remoteChannel = null;
  }
  if (storageListener !== null) {
    window.removeEventListener("storage", storageListener);
    storageListener = null;
  }
  listeningRemoteInvalidation = false;
}

export interface ProjectionRequest {
  /** 发起时的缓存键；返回后与 projectionCacheKey() 不同 = 结果已失效。 */
  key: string;
  promise: Promise<PaperProjectionOut>;
  /** 不再需要这次结果（卸载/重取）：最后一个消费者退出时中止请求。 */
  cancel(): void;
}

function release(record: InFlightProjection): void {
  record.consumers -= 1;
  if (record.consumers <= 0 && inFlight === record) {
    inFlight = null;
    record.controller.abort();
  }
}

function startRequest(key: string): ProjectionRequest {
  const controller = new AbortController();
  const record: InFlightProjection = {
    key,
    controller,
    consumers: 1,
    promise: getCurrentProjection(controller.signal).then((data) => {
      if (inFlight === record) inFlight = null;
      if (projectionCacheKey() === key) entry = { key, data };
      return data;
    }),
  };
  record.promise.catch(() => {
    if (inFlight === record) inFlight = null;
  });
  inFlight = record;
  return { key, promise: record.promise, cancel: () => release(record) };
}

/**
 * 取当前组投影：同键命中缓存直接返回；同键在飞则复用（消费者计数），键不同则先取消旧请求。
 */
export function requestProjection(): ProjectionRequest {
  const key = projectionCacheKey();
  const cached = getCachedProjection();
  if (cached !== null) {
    return { key, promise: Promise.resolve(cached.data), cancel: () => {} };
  }
  if (inFlight !== null && inFlight.key === key) {
    const shared = inFlight;
    shared.consumers += 1;
    return { key, promise: shared.promise, cancel: () => release(shared) };
  }
  if (inFlight !== null) {
    inFlight.controller.abort();
    inFlight = null;
  }
  return startRequest(key);
}
