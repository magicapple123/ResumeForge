// SPDX-License-Identifier: Apache-2.0
/** AI 生成简历弹窗：配置岗位导向美化/篇幅 -> 流式生成 -> 预览结果（自动保存历史）。 */
import { App, Modal } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { attachTaskUi, watchResumeTask } from "../utils/backgroundTasks";
import { isDocumentHidden, onVisibilityChange } from "../utils/visibility";
import {
  cancelResumeGenerateTask,
  fetchResumeTemplates,
  getResume,
  getResumeGenerateTask,
  renderResume,
  startResumeGeneration,
  updateResume,
  updateResumeLayout,
} from "../api/resumes";
import { getLLMConfig } from "../api/settings";
import { formatErrorGuidance } from "../api/errorGuidance";
import type {
  EnhancementLevel,
  Job,
  ResumeContent,
  ResumeDetail,
  ResumeGenerateTask,
  ResumeLayout,
} from "../types";
import type { ResumeFormatConfig } from "../types/resumeFormat";
import type { LayoutMeasure } from "../utils/resumeLayoutMeasure";
import { buildSectionOrderConfig, DEFAULT_RESUME_SECTION_ORDER } from "../utils/resumeSectionOrder";
import { useResumeRelayout } from "../features/resume/useResumeRelayout";
import type { ResumePreviewHandle } from "./ResumePreview";
import GenerationConfigStage from "./generate-resume/GenerationConfigStage";
import GenerationProgressStage from "./generate-resume/GenerationProgressStage";
import GenerationErrorStage from "./generate-resume/GenerationErrorStage";
import GenerationPreviewStage from "./generate-resume/GenerationPreviewStage";
import type { GenerateResult } from "./generate-resume/GenerationPreviewStage";

type Stage = "config" | "generating" | "preview" | "error";

interface Props {
  /** null 表示生成**通用简历**（不针对任何岗位）。 */
  job: Job | null;
  open: boolean;
  /** 通用简历的初始名称，留空则后端按「姓名-通用简历-时间戳」命名。 */
  initialTitle?: string;
  onClose: () => void;
}

export default function GenerateResumeModal({ job, open, initialTitle = "", onClose }: Props) {
  const { message, notification } = App.useApp();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>("config");
  const [title, setTitle] = useState("");
  const [enhance, setEnhance] = useState(false);
  const [enhancementLevel, setEnhancementLevel] = useState<EnhancementLevel>("balanced");
  // 默认 1 页 A4 + 标准字号：绝大多数简历就该是一页。
  const [layout, setLayout] = useState<ResumeLayout>({
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
  });
  const [customInstruction, setCustomInstruction] = useState("");
  const [layoutStatus, setLayoutStatus] = useState<{
    pages: number;
    scale: number;
    overflow: boolean;
  } | null>(null);
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const [pdfDirectAvailable, setPdfDirectAvailable] = useState(true);
  const [modelName, setModelName] = useState("");
  const [llmReady, setLlmReady] = useState(true);
  // 生成改为后台任务：taskId 驱动轮询，task 是最近一次轮询到的状态。
  const [taskId, setTaskId] = useState<number | null>(null);
  const [task, setTask] = useState<ResumeGenerateTask | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);
  const [suggestionsResetKey, setSuggestionsResetKey] = useState(0);

  // 生成开始时的版式快照：后台完成后用它渲染预览，避免完成后用户又改了配置导致
  // 预览参数与生成参数不一致。
  const generationLayoutRef = useRef<ResumeLayout>(layout);
  // 预览句柄：拖动字号时用它把探针 CSS 即时注入预览（本地缩放，无网络往返）。
  const previewRef = useRef<ResumePreviewHandle>(null);

  /**
   * 版式重排：尾随合并（`useResumeRelayout`，项 6 / D11）。
   *
   * 与 `ResumeDetailModal` 的差异只有 `render` 里的最后一步：这里记录已经落库，所以
   * 重渲染成功后还要把版式写回记录。但**写回失败不回滚 layout**——画面与记录的一致性是
   * "下次打开才看得见"的问题，此刻把版面弹回旧值只会让用户更困惑；失败用 message 说明。
   */
  const { relayouting, request: requestLayout } = useResumeRelayout({
    render: async (next) => {
      const detail = result?.detail;
      if (!detail) return;
      setPreviewHtml(await renderResume(detail.content, next));
      if (!detail.id) return;
      try {
        await updateResumeLayout(detail.id, next);
      } catch (err) {
        // 只提示、不回滚：版式本身已经渲染成功，弹出旧版式会让"我刚调好的"凭空消失。
        message.error(err instanceof Error ? err.message : "版式写回记录失败");
      }
    },
    onRendered: (next) => setLayout(next),
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "按新版式渲染失败");
      // D13：探针是"我看到的"，渲染失败就必须清掉，不能继续呈现一个不存在的状态。
      previewRef.current?.setLiveProbe("");
    },
  });

  // 后台生成是否仍在进行：决定"重新打开弹窗"时是接着看进度，还是回到配置页。
  // 生成中关掉弹窗（后台继续）不 reset，所以 stage 会留在 generating；等它跑到终态
  // （completed/cancelled/failed）后 taskId 被清空、stage 被改写，这里跟着变 false。
  const generatingInBackground = stage === "generating" && taskId != null;
  const generatingRef = useRef(generatingInBackground);
  useEffect(() => {
    generatingRef.current = generatingInBackground;
  }, [generatingInBackground]);

  // 打开时把资料页填的名称带进来。reset() 只在关闭时跑，不补这一步的话
  // 名称输入框永远是空的。Compiler 规范：渲染期守卫式调整（哨兵 null 覆盖挂载即打开）。
  const [prevTitleSync, setPrevTitleSync] = useState<{
    open: boolean;
    initialTitle: string;
  } | null>(null);
  if (
    prevTitleSync === null ||
    prevTitleSync.open !== open ||
    prevTitleSync.initialTitle !== initialTitle
  ) {
    setPrevTitleSync({ open, initialTitle });
    if (open) setTitle(initialTitle);
  }

  // 重新打开弹窗时回到配置页；唯一例外是上次的生成还在后台跑（生成中关掉的），
  // 此时保持 generating 让用户接着看进度——否则"生成中关掉 → 后台完成 → 再打开"
  // 会看到一份过期/错位的预览。
  useEffect(() => {
    if (!open) return;
    if (generatingRef.current) return;
    setStage("config");
    setResult(null);
    setPreviewHtml("");
    setErrorMsg("");
  }, [open]);

  // 打开弹窗时检查 LLM 配置并展示当前模型
  useEffect(() => {
    if (!open) return;
    void getLLMConfig()
      .then((config) => {
        setModelName(config.model || "");
        setLlmReady(!!config.base_url && !!config.model);
      })
      .catch(() => setLlmReady(false));
  }, [open]);

  // 每次打开都按后端给的默认值重置版式，并记下服务端能不能直接生成 PDF。
  useEffect(() => {
    if (!open) return;
    void fetchResumeTemplates()
      .then((catalog) => {
        setPdfDirectAvailable(catalog.pdf_direct_available);
        // 默认板块顺序跟随「我的资料」：用户在资料页把项目拖到最前，生成出来的简历也
        // 该是项目在前。与内置默认相同时不写 `section_order`（"没调过"与"调成和默认
        // 一样"应当是同一种存储形态）；其它 format_config 键（夹带进来的字号系数等）保留。
        const builtInOrder = catalog.default_section_order ?? DEFAULT_RESUME_SECTION_ORDER;
        const profileOrder = catalog.profile_section_order ?? builtInOrder;
        // 三个参数都要重置。此前漏了 page_limit（只覆盖 template / font_scale），
        // 于是上一次选过 3 页的话，下次打开默认就是 3 页，与"默认一页 A4"相矛盾。
        setLayout((current) => ({
          ...current,
          template: catalog.defaults.template,
          format_name: catalog.defaults.format_name ?? "",
          font_scale: catalog.defaults.font_scale,
          page_limit: catalog.defaults.page_limit,
          format_config: buildSectionOrderConfig(
            profileOrder,
            builtInOrder,
            current.format_config ?? {},
          ),
        }));
      })
      .catch(() => {
        // 取不到目录就用内置默认值，不影响生成。
      });
  }, [open]);

  const reset = useCallback(() => {
    setStage("config");
    setTitle(initialTitle);
    setTaskId(null);
    setTask(null);
    setErrorMsg("");
    setResult(null);
    setPreviewHtml("");
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
    setLayoutStatus(null);
    setMeasure(null);
    setCustomInstruction("");
  }, [initialTitle]);

  const loadPreview = useCallback(async (resumeId: number) => {
    try {
      const detail = await getResume(resumeId);
      const html = await renderResume(detail.content, generationLayoutRef.current);
      setResult({ detail });
      setPreviewHtml(html);
      setStage("preview");
    } catch (err) {
      setStage("error");
      setErrorMsg(err instanceof Error ? err.message : "生成完成，但加载结果失败");
    }
  }, []);

  const startGenerate = async () => {
    if (!open) return;
    generationLayoutRef.current = layout;
    setStage("generating");
    setTaskId(null);
    setTask(null);
    setErrorMsg("");
    setResult(null);
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
    try {
      const started = await startResumeGeneration({
        job_id: job?.id ?? null,
        title: job ? "" : title.trim(),
        options: {
          enhance,
          enhancement_level: enhancementLevel,
          page_limit: layout.page_limit,
          font_scale: layout.font_scale,
          template: layout.template,
          format_name: layout.format_name,
          // 生成时定下的版式覆盖必须跟着请求走：不然用户在配置页调的顺序 / 字号
          // 只影响"这次预览"，关掉弹窗再从简历中心打开就变回去了。
          format_config: layout.format_config ?? {},
          custom_instruction: customInstruction.trim(),
        },
      });
      setTaskId(started.id);
      setTask(started);
      // 登记到模块级登记表：关掉弹窗后仍会被追踪，完成时统一弹窗 + 响铃。
      watchResumeTask(started, job ? `为「${job.title}」生成简历` : "生成通用简历");
    } catch (err) {
      setStage("error");
      // RF-20：失败不只显示原始异常——给「原因 + 建议 + 编号」指引。
      setErrorMsg(formatErrorGuidance(err, "启动生成失败，请重试"));
    }
  };

  // 轮询后台任务：进入终态前每 1.5s 拉一次状态（弹窗内的进度显示用它）。
  //
  // 与 `utils/backgroundTasks` 的分工：**这一份只管弹窗里的进度显示**，"关掉弹窗之后
  // 仍然被追踪、并在完成时统一提醒"由登记表的轮询负责。两边各拉一次是有意的取舍——
  // 共享同一份 React 状态会让"完成时把任务从列表里删掉"和"弹窗还要读终态"互相打架
  // （实测会陷入无限更新）。两条轮询互不依赖，任一条断掉都不影响另一条。
  useEffect(() => {
    if (taskId == null) return;
    let disposed = false;
    const poll = async () => {
      try {
        const updated = await getResumeGenerateTask(taskId);
        if (!disposed) setTask(updated);
      } catch {
        // 轮询失败（后端短暂不可用）不打断，等下一轮自愈。
      }
    };
    void poll();
    // 页面在后台时跳过本轮 tick；回到前台由 visibilitychange 立即补一次。
    const timer = window.setInterval(() => {
      if (isDocumentHidden()) return;
      void poll();
    }, 1500);
    const unsubscribeVisibility = onVisibilityChange(() => {
      if (isDocumentHidden()) return;
      void poll();
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribeVisibility();
    };
  }, [taskId]);

  // 弹窗开着时声明"界面在看这个任务"：完成后用右上角卡片提醒，不弹居中弹窗打断用户。
  //
  // detach 只跟随弹窗关闭，不跟随 taskId 置空：任务进入终态时弹窗收尾会把 taskId
  // 置空（见下面的完成分支），但弹窗仍开着展示预览——若跟着 detach，registry 稍后
  // 的完成通知会误判"用户已经走开"，给正看着预览的用户升级成居中弹窗。React 19 的
  // 被动副作用落点让这个竞态从偶发变成确定性发生，"在看"的生命周期必须跟随弹窗。
  const detachTaskUiRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!open) {
      detachTaskUiRef.current?.();
      detachTaskUiRef.current = null;
      return;
    }
    if (taskId == null || detachTaskUiRef.current) return;
    detachTaskUiRef.current = attachTaskUi(taskId);
  }, [open, taskId]);
  useEffect(() => {
    // 组件卸载兜底释放，防止登记表泄漏。
    return () => detachTaskUiRef.current?.();
  }, []);

  // 任务进入终态后的收尾：完成→取简历进预览并提醒；取消→回配置；失败→错误。
  // 本质是"派生事件"（后台任务轮询到达终态后的收尾扇出）：状态收尾与 loadPreview
  // 副作用在此汇合，改为回调直连需要重构轮询器，故按书面理由豁免 Compiler 规则。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!task) return;
    if (task.status === "completed") {
      const resumeId = task.resume_id;
      setTaskId(null);
      setTask(null);
      if (resumeId == null) {
        // 完成却没回填记录 id：理论上不会发生（完成一定先落库），防御性当作失败处理，
        // 避免卡在"完成"状态却永远拿不到预览。
        setErrorMsg("生成完成，但结果记录缺失，请重试");
        setStage("error");
        return;
      }
      // 完成提醒（弹窗 + 提示音）由 `utils/backgroundTasks` 统一发：只有它知道用户
      // 是"还在看弹窗"还是"已经走开了"，也只有它能保证关掉弹窗后仍然提醒。
      void loadPreview(resumeId);
    } else if (task.status === "cancelled") {
      setTaskId(null);
      setTask(null);
      setStage("config");
      message.info("已取消生成");
    } else if (task.status === "failed") {
      setTaskId(null);
      setErrorMsg(task.error || "生成失败，请重试");
      setStage("error");
    }
  }, [task, notification, message, navigate, loadPreview]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleCancelGenerate = async () => {
    if (taskId == null) return;
    try {
      const cancelled = await cancelResumeGenerateTask(taskId);
      setTask(cancelled);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "取消失败，请重试");
    }
  };

  const handleClose = () => {
    // 生成中关弹窗 = 后台继续（不是取消）：任务继续跑，完成后提醒；其余阶段照旧复位。
    if (stage === "generating" && taskId != null) {
      onClose();
      return;
    }
    reset();
    onClose();
  };

  const saveEditedResume = async (content: ResumeContent) => {
    const recordId = result?.detail.id;
    if (!recordId) {
      throw new Error("简历记录尚未保存完成，请稍后再试");
    }
    const updated = await updateResume(recordId, content);
    const html = await renderResume(updated.content, layout);
    setResult({ detail: updated });
    setPreviewHtml(html);
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
    message.success("简历修改已保存");
  };

  /**
   * AI 修订（采纳建议）成功后的刷新：修订已在服务端落库，这里按新内容重渲染预览。
   * 生成弹窗不显示「AI 修改 / 重新生成」入口（``showReviseAction={false}``）——
   * extraActions 里已有走完整生成流程的「重新生成」，两个同名按钮会互相混淆。
   */
  const applyRevisedDetail = async (updated: ResumeDetail) => {
    const html = await renderResume(updated.content, layout);
    setResult({ detail: updated });
    setPreviewHtml(html);
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
  };

  /**
   * 「自动一页」已由诊断卡写回配置，这里只需按新配置重渲染一次（同一条重排通道）。
   *
   * 换模板/加页数/改字号直接走 `requestLayout`（不再需要包装函数）。
   */
  const applyFittedFormat = (formatConfig: ResumeFormatConfig) => {
    requestLayout({ ...layout, format_config: formatConfig });
  };

  return (
    <Modal
      title={job ? `为「${job.title}」生成简历` : "生成通用简历"}
      open={open}
      onCancel={handleClose}
      // 宽度与 body 限高对齐简历中心的预览弹窗（ResumeDetailModal）：预览阶段渲染的是
      // 同一个 ResumeDetailPreview，两边布局应一致；限高让超长的预览只滚弹窗内部，
      // 卡片整体始终完整呈现在视口内。
      width="min(960px, 96vw)"
      footer={null}
      styles={{
        // 与简历中心的预览弹窗保持同一套滚动口径：右侧留 12px 让正文不贴滚动条，
        // 负外边距把这 12px 从弹窗内边距借回来，内容宽度不变（见 ResumeDetailModal）。
        body: {
          maxHeight: "var(--rf-modal-body-max-h)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 12,
          marginRight: -12,
        },
      }}
      destroyOnHidden
    >
      {stage === "config" && (
        <GenerationConfigStage
          job={job}
          title={title}
          setTitle={setTitle}
          enhance={enhance}
          setEnhance={setEnhance}
          enhancementLevel={enhancementLevel}
          setEnhancementLevel={setEnhancementLevel}
          layout={layout}
          setLayout={setLayout}
          customInstruction={customInstruction}
          setCustomInstruction={setCustomInstruction}
          llmReady={llmReady}
          modelName={modelName}
          onClose={handleClose}
          onStart={() => void startGenerate()}
        />
      )}

      {stage === "generating" && (
        <GenerationProgressStage
          task={task}
          taskId={taskId}
          onClose={handleClose}
          onCancel={() => void handleCancelGenerate()}
        />
      )}

      {stage === "preview" && result && (
        <GenerationPreviewStage
          result={result}
          previewHtml={previewHtml}
          layout={layout}
          layoutStatus={layoutStatus}
          measure={measure}
          pdfDirectAvailable={pdfDirectAvailable}
          relayouting={relayouting}
          previewRef={previewRef}
          setLayoutStatus={setLayoutStatus}
          setMeasure={setMeasure}
          applyLayout={requestLayout}
          applyFittedFormat={applyFittedFormat}
          saveEditedResume={(content) => saveEditedResume(content)}
          applyRevisedDetail={(updated) => applyRevisedDetail(updated)}
          suggestionsGenerated={suggestionsGenerated}
          suggestionsResetKey={suggestionsResetKey}
          setSuggestionsGenerated={setSuggestionsGenerated}
          onGoResumes={() => navigate("/resumes")}
          onRegenerate={() => void startGenerate()}
          onClose={handleClose}
        />
      )}

      {stage === "error" && (
        <GenerationErrorStage
          errorMsg={errorMsg}
          onReset={reset}
          onRegenerate={() => void startGenerate()}
        />
      )}
    </Modal>
  );
}
