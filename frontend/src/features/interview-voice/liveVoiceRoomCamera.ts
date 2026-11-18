// SPDX-License-Identifier: Apache-2.0
/**
 * 摄像头「打不开」的唯一判据与唯一话术（I-26）。
 *
 * 为什么单独抽：同一件事原先有两套入口、只有一套有保护——左栏占位按钮知道总开关关着
 * （`disabled` + 一行小字），底栏按钮什么都不知道，点下去被 `toggleCamera` 第一行
 * `return` 掉，于是用户得到"功能坏了"的结论。现在两处按钮都读同一个 `CameraBlockedReason`，
 * 而且话术**只有一个来源**：占位按钮下面那行小字、底栏按钮的悬停提示、点击后的轻提示，
 * 三处说的是同一句话。
 *
 * 另一条不能动的边界：总开关默认关是隐私红线（见 `cameraSettings` 文件头）。这里修的是
 * "点了没反馈"，不是"顺手把开关打开"——`cameraBlockedReason` 只负责解释与出口。
 *
 * 文案暂为内联中文：i18n 语言包属主是主理人（本轮执行方不得改 `src/i18n/**`），
 * 需要正式化的键见交付回报（`interviewVoice.room.cameraNotice.*`）。
 */
import { t, type MessageKey } from "../../i18n";

/** 两处按钮共用的"当前为什么打不开"。`null` = 可以尝试打开。 */
export type CameraBlockedReason = "off" | "denied" | "no-device" | null;

/** `getUserMedia` 的失败分类（含"浏览器不支持"这种没有异常对象的情况）。 */
export type CameraFailure = "unsupported" | "denied" | "no-device" | "busy" | "unknown";

/** 设置页「语音与面试」分组：面试镜头那张卡就在这一组里。 */
export const CAMERA_SETTINGS_PATH = "/settings?tab=voice";

/**
 * 同一句话的三个来源共用这一份（左栏小字 / 底栏悬停 / 点击后的轻提示）。
 *
 * 只放**键名**、不放文案：文案在 `interviewVoice.camera.notice.*` 里，运行期由 `t()` 取。
 * 之前这里是硬编码中文，`cjkRatchet`（存量中文只许下降的棘轮）会把它算成新增中文——
 * 产品文案必须走 i18n，否则英文界面下会漏出中文。
 */
const SENTENCE_KEYS: Record<Exclude<CameraBlockedReason, null> | CameraFailure, MessageKey> = {
  off: "interviewVoice.camera.notice.off",
  denied: "interviewVoice.camera.notice.denied",
  "no-device": "interviewVoice.camera.notice.no-device",
  busy: "interviewVoice.camera.notice.busy",
  unsupported: "interviewVoice.camera.notice.unsupported",
  unknown: "interviewVoice.camera.notice.unknown",
};

/**
 * 把 `getUserMedia` 抛出的错误收成四类。
 *
 * 只按 `err.name` 判断：不同浏览器给的名字不一样（Chrome 的 `NotReadableError`
 * 在旧版 Safari 叫 `TrackStartError`），认名字比认 message 稳。
 */
export function classifyCameraError(error: unknown): CameraFailure {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-device";
    case "NotReadableError":
    case "TrackStartError":
      // 设备在，但被别的程序（会议软件、另一个标签页）占着。
      return "busy";
    default:
      return "unknown";
  }
}

/** 开关关着时"打不开"的确定原因；开着时由上一次失败决定，没失败就是 `null`。 */
export function cameraBlockedReason(
  enabled: boolean,
  failure: CameraFailure | null,
): CameraBlockedReason {
  if (!enabled) return "off";
  if (failure === "denied") return "denied";
  if (failure === "no-device") return "no-device";
  // `busy` / `unsupported` / `unknown` 不是"被规则挡住"，而是"这次没成"：
  // 保持 `null`，按钮仍然可以再试，话术走 `cameraNotice` 的失败分支。
  return null;
}

/**
 * 两处按钮、轻提示共用的那句话。
 *
 * 顺序：先解释"为什么现在打不开"（开关 / 权限 / 设备），没有确定原因时再报上一次失败，
 * 都没有就返回 `null`——调用方据此显示正常的"本机预览"。
 */
export function cameraNotice(enabled: boolean, failure: CameraFailure | null): string | null {
  const reason = cameraBlockedReason(enabled, failure);
  if (reason !== null) return t(SENTENCE_KEYS[reason]);
  if (failure !== null) return t(SENTENCE_KEYS[failure]);
  return null;
}

/** 「去设置」按钮的文字：与助手用量提示同一个键，避免出现第二种说法。 */
export function cameraSettingsActionLabel(): string {
  return t("contextUsage.goSettings");
}

/**
 * 打开设置页的摄像头分区。
 *
 * 通话是全屏覆盖层：在**同一个标签页**跳走会直接结束这场通话（房间卸载 → 轨道全部停掉）。
 * 所以开新标签页——`useCameraSettings` 监听 `storage` 事件，那边打开总开关后这边立即生效，
 * 用户回到原标签页就能接着按摄像头，不必重开一场面试。
 */
export function openCameraSettings(): void {
  if (typeof window === "undefined") return;
  window.open(CAMERA_SETTINGS_PATH, "_blank", "noopener,noreferrer");
}
