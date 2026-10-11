/** 首次使用「第一份交付」的三阶段进度：条件全部由真实数据驱动。
 *
 * 为什么不把"点过某个按钮"当完成：进度回答的是"你离第一份可交付简历还有多远"，
 * 只有台账/简历/岗位这些**事实数据**能回答它；点击记录只会让进度说谎。
 * 阶段条件拆成纯函数（``computeActivationStages``）便于独立测试；hook 只负责
 * memo 与"数据未就绪"的空态，复用首页已取的 getStats 数据，不新增请求。
 */
import { useMemo } from "react";
import type { Stats } from "../../types/search";

/** 一个阶段的去向：未完成时展示的 CTA（真实链接，键盘可达）。 */
export interface ActivationStageCta {
  label: string;
  hint: string;
  path: string;
}

export interface ActivationStage {
  key: "facts" | "target" | "deliver";
  title: string;
  description: string;
  done: boolean;
  /** 仅未完成阶段携带；完成态不需要去向。 */
  cta?: ActivationStageCta;
}

/** 阶段 1「准备事实」：有任何一条台账或一份简历就算有了底子。 */
export function isFactsDone(stats: Stats): boolean {
  return stats.claim_count > 0 || stats.resume_count > 0;
}

/** 阶段 2「选择目标岗位」：有岗位，且简历/队列/投递记录里出现了"对着岗位做事"的痕迹。 */
export function isTargetDone(stats: Stats): boolean {
  return (
    stats.job_count > 0 &&
    (stats.resume_with_job_count > 0 ||
      stats.apply_queue_count > 0 ||
      stats.latest_applications.length > 0)
  );
}

/** 阶段 3「核实并交付」：有简历且没有未核实的事实。
 *
 * 诚实口径：**交付动作本身不判定完成**——导出、投递都不改这个条件。
 * 阶段完成只看"无未核实事实且有简历"，因为"核实完"才是用户能推进的事，
 * "投没投出去"取决于对方，不该让进度卡在用户控制不了的事上。
 */
export function isDeliverDone(stats: Stats): boolean {
  return stats.resume_count > 0 && stats.pending_claim_count === 0;
}

/** 由 stats 计算三阶段（含未完成时的 CTA）。纯函数，可独立测试。 */
export function computeActivationStages(stats: Stats): ActivationStage[] {
  const factsDone = isFactsDone(stats);
  const targetDone = isTargetDone(stats);
  const deliverDone = isDeliverDone(stats);

  return [
    {
      key: "facts",
      title: "准备事实",
      description: "把经历录进我的资料，或从现成简历识别成草稿",
      done: factsDone,
      cta: factsDone
        ? undefined
        : {
            label: "去我的资料录入",
            hint: "手动填写不需要模型",
            path: "/profile",
          },
    },
    {
      key: "target",
      title: "选择目标岗位",
      description: "收一个岗位，为它生成或关联一份简历",
      done: targetDone,
      cta: targetDone
        ? undefined
        : stats.job_count === 0
          ? { label: "去岗位广场收岗位", hint: "手动录入或自动采集都行", path: "/jobs" }
          : {
              label: "为岗位生成或关联简历",
              hint: "有岗位了，还差一份对着它的简历",
              path: "/resumes",
            },
    },
    {
      key: "deliver",
      title: "核实并交付",
      description: "确认没有未核实的事实，然后导出或投出",
      done: deliverDone,
      cta: deliverDone
        ? undefined
        : stats.pending_claim_count > 0
          ? {
              label: `核实 ${stats.pending_claim_count} 条待确认事实`,
              hint: "没核实的说法不会进简历",
              path: "/claims",
            }
          : { label: "导出简历或发起投递", hint: "简历就绪后随时可以交出去", path: "/apply" },
    },
  ];
}

/** 首页消费的进度 hook：stats 未就绪时返回空阶段（面板不渲染）。 */
export function useActivationProgress(stats: Stats | undefined): {
  stages: ActivationStage[];
  allDone: boolean;
} {
  return useMemo(() => {
    if (!stats) return { stages: [], allDone: false };
    const stages = computeActivationStages(stats);
    return { stages, allDone: stages.every((stage) => stage.done) };
  }, [stats]);
}
