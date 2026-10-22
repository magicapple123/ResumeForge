// SPDX-License-Identifier: Apache-2.0
/**
 * 「不再提醒」的存储层：按 `code` 静音，**必须可撤销**。
 *
 * ## 为什么存 `"1"` 而不是 `generation`
 *
 * 「不再提醒」的字面语义是"别再跟我说这件事"。若存 `generation`，版本一变静音就自动失效，
 * 用户会觉得这个开关是假的——而他按它正是为了"别再烦我"。代价是"将来有新版本也不再提醒"，
 * 由三处兜住：设置页常驻恢复入口、`settings/UpdateCard` 继续工作、`isMuted()` 单点可改。
 *
 * ## 为什么落 `localStorage`
 *
 * 这里是**偏好**（布尔开关），不是正文。正文的隐私边界只管 `sessionStorage`（见
 * `utils/formDraftStorage.ts`），偏好落 `localStorage` 是仓库既有范式
 * （`welcomeGate.ts`、`RemindersCard.tsx` 都这么存）。
 */
import { ANNOUNCEMENT_CODES, isAnnouncementCode } from "./announcementCodes";
import type { AnnouncementCode } from "./announcementCodes";

export const MUTE_KEY_PREFIX = "resumeforge.announcement.muted.";

/** `localStorage` 被禁（隐私模式）时退回内存：本会话仍生效，只是不跨刷新。 */
const memoryMuted = new Set<AnnouncementCode>();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isMuted(code: AnnouncementCode): boolean {
  if (memoryMuted.has(code)) return true;
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(`${MUTE_KEY_PREFIX}${code}`) !== null;
  } catch {
    return false;
  }
}

/**
 * 只返回白名单内的 code。
 *
 * 用**前缀 slice** 还原而不是 `split(".")`：code 本身含点（`update.ready`），
 * 按点切会把 `update` 和 `ready` 拆成两段，还原出来的名字永远是错的。
 */
export function listMutedCodes(): AnnouncementCode[] {
  const found = new Set<AnnouncementCode>(memoryMuted);
  const store = storage();
  if (store) {
    try {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (!key || !key.startsWith(MUTE_KEY_PREFIX)) continue;
        const code = key.slice(MUTE_KEY_PREFIX.length);
        if (isAnnouncementCode(code)) found.add(code);
      }
    } catch {
      // 读不到就按"没有静音项"处理：静音只是降噪，不该让页面报错。
    }
  }
  // 顺序跟白名单走，界面上不会因为存储顺序不同而跳动。
  return ANNOUNCEMENT_CODES.filter((code) => found.has(code));
}

export function muteAnnouncement(code: AnnouncementCode): void {
  memoryMuted.add(code);
  const store = storage();
  if (!store) return;
  try {
    store.setItem(`${MUTE_KEY_PREFIX}${code}`, "1");
  } catch {
    // 写不进去时内存里仍然生效（本会话）。
  }
}

export function unmuteAnnouncement(code: AnnouncementCode): void {
  memoryMuted.delete(code);
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(`${MUTE_KEY_PREFIX}${code}`);
  } catch {
    // 同上：删不掉也不该让"恢复提醒"报错。
  }
}
