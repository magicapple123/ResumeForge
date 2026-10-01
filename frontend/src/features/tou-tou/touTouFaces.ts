/** 投投的运行时表情素材与「状态 → 素材」映射，保持原始 PNG，不做裁切。 */

import idleFace from "../../assets/toutou/ball-idle.png";
import curiousFace from "../../assets/toutou/ball-curious.png";
import thinkingFace from "../../assets/toutou/ball-thinking.png";
import doneFace from "../../assets/toutou/ball-done.png";
import errorFace from "../../assets/toutou/ball-error.png";
import sleepFace from "../../assets/toutou/ball-sleep.png";
import type { TouTouStatus } from "./touTouTypes";

/**
 * 素材表：一个 key 一张图，渲染时每张图一个 `<img>`（常驻 DOM，靠 `is-active` 淡入淡出）。
 *
 * 加一张新表情＝加一个 key（素材放进 `assets/toutou`），**不需要**改渲染逻辑。
 */
export const TOU_TOU_FACE_SOURCES = {
  idle: idleFace,
  curious: curiousFace,
  thinking: thinkingFace,
  done: doneFace,
  error: errorFace,
  sleep: sleepFace,
} as const;

export type TouTouFaceKey = keyof typeof TOU_TOU_FACE_SOURCES;

/**
 * 状态 → 素材。
 *
 * 状态比素材多：眨眼这种瞬间动作可以借用现成的闭眼素材（醒来之前先用睡着的脸顶着），
 * 有了专门的素材再把它指过去即可——改这里一行，别处不用动。
 */
export const TOU_TOU_STATUS_FACE: Record<TouTouStatus, TouTouFaceKey> = {
  idle: "idle",
  curious: "curious",
  thinking: "thinking",
  done: "done",
  error: "error",
  sleep: "sleep",
};

export function faceKeyFor(status: TouTouStatus): TouTouFaceKey {
  return TOU_TOU_STATUS_FACE[status];
}
