// SPDX-License-Identifier: Apache-2.0
/** 生成完成后的结果预览加载（从 GenerateResumeModal 拆出，保持单文件行预算）。 */
import { useCallback } from "react";
import type { RefObject } from "react";
import { getResume, renderResume } from "../../api/resumes";
import { t } from "../../i18n";
import type { ResumeDetail, ResumeLayout } from "../../types";
import type { GenerateResult } from "./GenerationPreviewStage";

interface Args {
  layoutRef: RefObject<ResumeLayout>;
  setResult: (result: GenerateResult | null) => void;
  setPreviewHtml: (html: string) => void;
  setStage: (stage: "preview" | "error") => void;
  setErrorMsg: (message: string) => void;
}

export function useGenerationPreviewLoader({
  layoutRef,
  setResult,
  setPreviewHtml,
  setStage,
  setErrorMsg,
}: Args) {
  return useCallback(
    async (resumeId: number) => {
      try {
        const detail: ResumeDetail = await getResume(resumeId);
        const html = await renderResume(detail.content, layoutRef.current);
        setResult({ detail });
        setPreviewHtml(html);
        setStage("preview");
      } catch (err) {
        setStage("error");
        setErrorMsg(err instanceof Error ? err.message : t("generate.loadResultFailed"));
      }
    },
    [layoutRef, setErrorMsg, setPreviewHtml, setResult, setStage],
  );
}
