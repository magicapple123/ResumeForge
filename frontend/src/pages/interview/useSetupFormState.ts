// SPDX-License-Identifier: Apache-2.0
/**
 * Form state and candidate data for the interview setup card.
 *
 * Moved out of `SetupTab.tsx` (500-line budget): pure move, hook call order and
 * effect dependencies unchanged. The locale subscription stays in `SetupTab.tsx`
 * because the rendered copy still lives there.
 */
import type { FormInstance } from "antd";
import { Form } from "antd";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { getExternalResume } from "../../api/externalResumes";
import type {
  InterviewDifficulty,
  InterviewMaterialExtract,
  InterviewType,
  InterviewerStyle,
} from "../../types";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import {
  describeCurrentMaterial,
  parseExternalResumeId,
  useExternalResumeApplier,
  useInterviewResumeSelect,
} from "../../hooks/useInterviewResumeSelect";
import { useSetupMaterials } from "./useSetupMaterials";

/** 轮数档位（问题 05）：自动收尾，或由用户指定的固定轮数。 */
export type RoundsMode = "auto" | "custom";

export interface SetupForm {
  /** 关联岗位：岗位侧只剩"从记录选"（Q3），所以它始终必填。 */
  jobId?: number;
  /**
   * 关联简历：与 `resumeMaterial` 二选一。**带前缀的字符串**（#25）：`r:<id>` = 本应用的
   * 简历，`e:<id>` = 外部简历——前缀就是 `onChange` 的分派依据；提交时由
   * `toInternalResumeId` 还原成后端要的数字 id（外部简历没有内部 id，正文走材料）。
   */
  resumeId?: string;
  /**
   * 岗位材料：**恒为 null**（Q3 岗位侧不再支持导入文件）。字段保留是因为页面的提交函数
   * 仍拿它判"岗位是否来自文件"，删字段要连着改 `InterviewPage.start`。
   */
  jobMaterial?: InterviewMaterialExtract | null;
  /** 导入的简历材料（#41）：已在上传时提取成文本。 */
  resumeMaterial?: InterviewMaterialExtract | null;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  /** 面试官风格：填了人设时不参与提示词（值仍保留，后端字段必填）。 */
  interviewerStyle: InterviewerStyle;
  /** 轮数档位：`auto` = 自动收尾（AI 按表现判断何时结束）。 */
  roundsMode: RoundsMode;
  /** 固定轮数，只在 `roundsMode === "custom"` 时生效。 */
  rounds: number;
  focus: string;
  persona: string;
}

export function useSetupFormState(
  form: FormInstance<SetupForm>,
  initialJobId: number | undefined,
  initialResumeMaterial: InterviewMaterialExtract | null | undefined,
) {
  // 从简历中心「用于面试」跳过来：把那份外部简历的**已提取正文**预填到"导入文件"这一侧。
  // 刻意不新增第三种来源：record / file 二选一已经能表达"这份材料来自文件快照"。
  const [searchParams] = useSearchParams();
  const externalResumeId = parseExternalResumeId(searchParams.get("externalResumeId"));
  const prefilledExternalIdRef = useRef<number | null>(null);
  // 关联岗位下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  // 关联简历（0066 / #25）：候选 = 所选岗位关联的简历 **+** 通用简历 **+** 外部简历（分组展示）。
  // 未选岗位时展示全部内部与外部简历，岗位材料和简历材料可以分别选择。
  const watchedJobId = Form.useWatch("jobId", form) as number | undefined;
  const watchedResumeValue = Form.useWatch("resumeId", form) as string | undefined;
  // 人设与风格互斥（问题 06）：**看的是实时值**，所以用 useWatch 而不是读 initialValues——
  // 用户边打人设，风格下拉边变灰，无需先提交或失焦。
  const persona = Form.useWatch("persona", form) as string | undefined;
  const hasPersona = (persona ?? "").trim().length > 0;
  // 轮数两档（问题 05）：只有「指定轮数」才渲染输入框，默认「自动」。
  const roundsMode = (Form.useWatch("roundsMode", form) as RoundsMode | undefined) ?? "auto";
  const showRoundsInput = roundsMode === "custom";
  // 材料来源（#41）：简历侧是"从记录选 / 导入文件"二选一，切换时互相清空，
  // 避免"上边选着记录，下边还留着上次的文件正文"这种谁也说不清的状态。
  // Q3：岗位侧已经没有材料来源了（只从记录选），所以这里只剩简历一侧。
  const {
    resumeSource,
    setResumeSource,
    resumeMaterial,
    setResumeMaterial,
    resumeFileOrigin,
    setResumeFileOrigin,
  } = useSetupMaterials(initialResumeMaterial);

  // 外部简历落地（深链与下拉**共用**这一个函数）：引用稳定，深链 effect 才不会每渲染重跑。
  const externalResume = useExternalResumeApplier({
    useFileSource: () => setResumeSource("file"),
    useFileMaterial: (material) => {
      setResumeMaterial(material);
      setResumeFileOrigin("external");
    },
    clearRecordValue: () => form.setFieldValue("resumeId", undefined),
  });
  const resumeSelect = useInterviewResumeSelect({
    jobId: watchedJobId ?? null,
    value: watchedResumeValue,
    onExternal: externalResume.apply,
    onExternalFailed: externalResume.notifyFailed,
    onSelectInternal: (value) => form.setFieldValue("resumeId", value),
  });

  // 岗位一变就重拉简历候选：上一次的候选属于上一个岗位，留着会让用户挑到不该出现的简历。
  // 外部简历组不随岗位变（列表接口没有 job_id 参数），`reload` 里一并刷新；已选项由
  // hook 的 `pinned` 缓存保住显示。
  useEffect(() => {
    resumeSelect.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedJobId]);

  // 外部简历深链预填（第 21 条）：只处理一次。StrictMode 下 effect 会"跑一遍 → 清理 →
  // 再跑一遍"：如果把 ref 记在 effect 开头，第二次跑会以为"处理过了"而直接退出，第一次
  // 的请求又被清理标记成 cancelled —— 结果永远不预填。所以 ref 记在**真正处理成功**的位置，
  // 两次请求最多浪费一次 GET（与弹层数据加载同一种取舍）。
  useEffect(() => {
    if (externalResumeId === null || prefilledExternalIdRef.current === externalResumeId) return;
    let cancelled = false;
    void getExternalResume(externalResumeId)
      .then((record) => {
        if (cancelled) return;
        prefilledExternalIdRef.current = externalResumeId;
        // 与下拉选中走同一个函数：切来源、写材料、清记录侧的 id（漏掉清 id 就是脏状态）。
        externalResume.apply(record);
      })
      .catch(() => {
        if (!cancelled) externalResume.notifyFailed();
      });
    return () => {
      cancelled = true;
    };
  }, [externalResumeId, externalResume]);

  // 深链预填的岗位按 id 回查补进候选（P0-1），否则第 101 条之后的岗位只显示 id；
  // 设定卡常驻可见，挂载时同时预拉第一页候选。
  useEffect(() => {
    void jobSelect.ensure(initialJobId);
    void jobSelect.reload();
    // hook 的回调引用稳定，只跟随预填目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  /**
   * 「当前材料」（#25）：选中外部简历后记录侧下拉是**空的**（材料落在"导入文件"那一侧），
   * 不显式说清现在用的是哪一份，用户会以为系统把文件弄丢了。判据与文案在 hook 里。
   */
  const currentMaterialText = describeCurrentMaterial({
    source: resumeSource,
    recordLabel: resumeSelect.labelFor(watchedResumeValue),
    fileName: resumeMaterial?.name,
    fileOrigin: resumeFileOrigin,
  });

  return {
    jobSelect,
    resumeSource,
    setResumeSource,
    resumeMaterial,
    setResumeMaterial,
    setResumeFileOrigin,
    resumeSelect,
    hasPersona,
    showRoundsInput,
    currentMaterialText,
  };
}
