/** 简（面试官）的运行时表情素材与「状态 → 素材」映射，透明底 WebP，512×512。 */

import idleFace from "../../assets/jane/jane-idle.webp";
import thinkingFace from "../../assets/jane/jane-thinking.webp";
import questioningFace from "../../assets/jane/jane-questioning.webp";
import encourageFace from "../../assets/jane/jane-encourage.webp";
import strictFace from "../../assets/jane/jane-strict.webp";
import noteFace from "../../assets/jane/jane-note.webp";
import type { InterviewerStyle } from "../../types";

/**
 * 素材表：一个 key 一张图，渲染时只渲染对应的那一张 `<img>`。
 *
 * 加一张新表情＝加一个 key（素材放进 `assets/jane`），**不需要**改渲染逻辑。
 */
export const JANE_FACE_SOURCES = {
  idle: idleFace,
  thinking: thinkingFace,
  questioning: questioningFace,
  encourage: encourageFace,
  strict: strictFace,
  note: noteFace,
} as const;

export type JaneFaceKey = keyof typeof JANE_FACE_SOURCES;

/**
 * 面试官风格 → 默认表情。
 *
 * key 钉死为 `InterviewerStyle` 白名单：白名单加风格时这里编译报错，
 * 强制补一条映射，避免新风格静默回退成 idle。
 */
export const JANE_STYLE_FACE: Record<InterviewerStyle, JaneFaceKey> = {
  严谨专业: "idle",
  温和引导: "encourage",
  持续追问: "questioning",
  压力质询: "strict",
};

/** 风格缺失或不在白名单（后端可能返回自定义字符串）时回退 idle。 */
export function janeFaceForStyle(style: InterviewerStyle | string | undefined): JaneFaceKey {
  if (style && style in JANE_STYLE_FACE) {
    return JANE_STYLE_FACE[style as InterviewerStyle];
  }
  return "idle";
}

/**
 * 评分报告 → Jane 的批改表情（report.score 为 0-100）。
 *
 * 阈值与报告维度 Tag 的档位一致（>=80 优 / >=60 中 / 其余待改进），
 * 分数缺失时保持平和，不替用户下结论。
 */
export function janeFaceForScore(score: number | undefined): JaneFaceKey {
  if (score === undefined || Number.isNaN(score)) {
    return "idle";
  }
  if (score >= 80) {
    return "encourage";
  }
  if (score >= 60) {
    return "idle";
  }
  return "strict";
}
