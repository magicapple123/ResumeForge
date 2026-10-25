// SPDX-License-Identifier: Apache-2.0
/**
 * 生成弹窗里「本次生成专属」的两个可选上下文（契约 §5 文档模式 / §2.5 职业场景）。
 *
 * 抽成 hook 的原因：GenerateResumeModal 已贴 500 行预算，而这两项的**默认值与复位口径**
 * 只该有一处实现——请求侧再用"条件展开"保证未改动时请求体与旧版逐字节一致。
 */
import { useCallback, useState } from "react";
import type { CareerContextRequest } from "./types";

export type GenerationDocumentMode = "resume" | "long_cv";

export interface GenerationExtras {
  documentMode: GenerationDocumentMode;
  setDocumentMode: (mode: GenerationDocumentMode) => void;
  /** null = 不启用：请求体里不出现 career_context 键。 */
  careerContext: CareerContextRequest | null;
  setCareerContext: (next: CareerContextRequest | null) => void;
  /** 关闭弹窗时复位到默认（普通简历 + 不启用场景）。 */
  resetExtras: () => void;
}

export function useGenerationExtras(): GenerationExtras {
  const [documentMode, setDocumentMode] = useState<GenerationDocumentMode>("resume");
  const [careerContext, setCareerContext] = useState<CareerContextRequest | null>(null);
  const resetExtras = useCallback(() => {
    setDocumentMode("resume");
    setCareerContext(null);
  }, []);
  return { documentMode, setDocumentMode, careerContext, setCareerContext, resetExtras };
}
