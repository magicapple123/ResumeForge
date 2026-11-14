// SPDX-License-Identifier: Apache-2.0
/**
 * Background-task wiring of the AI resume-generate modal: poll the task, attach the
 * completion UI, finalise on terminal states and cancel. Split out of
 * `./GenerateResumeModal.tsx` to keep both files under the line budget; pure move,
 * no behaviour change.
 */
import { App } from "antd";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { cancelResumeGenerateTask, getResumeGenerateTask } from "../../../api/resumes";
import { t } from "../../../i18n";
import type { RagRetrieval, ResumeGenerateTask } from "../../../types";
import { attachTaskUi, resumeTaskKey } from "../../../utils/backgroundTasks";
import { isDocumentHidden, onVisibilityChange } from "../../../utils/visibility";

type Stage = "config" | "generating" | "preview" | "error";

interface Options {
  open: boolean;
  taskId: number | null;
  task: ResumeGenerateTask | null;
  loadPreview: (resumeId: number) => Promise<void>;
  message: ReturnType<typeof App.useApp>["message"];
  setTaskId: Dispatch<SetStateAction<number | null>>;
  setTask: Dispatch<SetStateAction<ResumeGenerateTask | null>>;
  setRagAudit: Dispatch<SetStateAction<RagRetrieval | null>>;
  setErrorMsg: Dispatch<SetStateAction<string>>;
  setStage: (stage: Stage) => void;
}

export function useGenerateTaskPolling({
  open,
  taskId,
  task,
  loadPreview,
  message,
  setTaskId,
  setTask,
  setRagAudit,
  setErrorMsg,
  setStage,
}: Options) {
  // 轮询后台任务：进入终态前每 1.5s 拉一次状态（弹窗内的进度显示用它）。
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
  }, [setTask, taskId]);

  // 弹窗开着时声明"界面在看这个任务"：完成后用右上角卡片提醒，不弹居中弹窗打断用户。
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
    detachTaskUiRef.current = attachTaskUi(resumeTaskKey(taskId));
  }, [open, taskId]);
  useEffect(() => {
    // 组件卸载兜底释放，防止登记表泄漏。
    return () => detachTaskUiRef.current?.();
  }, []);

  // 任务进入终态后的收尾：完成→取简历进预览并提醒；取消→回配置；失败→错误。
  // 本质是"派生事件"（后台任务轮询到达终态后的收尾扇出）：状态收尾与 loadPreview
  // 副作用在此汇合，改为回调直连需要重构轮询器，故按书面理由豁免 Compiler 规则。
  useEffect(() => {
    if (!task) return;
    if (task.status === "completed") {
      const resumeId = task.resume_id;
      setRagAudit(task.rag ?? null);
      setTaskId(null);
      setTask(null);
      if (resumeId == null) {
        // 完成却没回填记录 id：理论上不会发生（完成一定先落库），防御性当作失败处理，
        // 避免卡在"完成"状态却永远拿不到预览。
        setErrorMsg(t("generate.resultMissing"));
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
      message.info(t("generate.cancelled"));
    } else if (task.status === "failed") {
      setTaskId(null);
      setErrorMsg(task.error || t("generate.failed"));
      setStage("error");
    }
  }, [loadPreview, message, setErrorMsg, setRagAudit, setStage, setTask, setTaskId, task]);

  const handleCancelGenerate = async () => {
    if (taskId == null) return;
    try {
      const cancelled = await cancelResumeGenerateTask(taskId);
      setTask(cancelled);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("generate.cancelFailed"));
    }
  };

  return { handleCancelGenerate };
}
