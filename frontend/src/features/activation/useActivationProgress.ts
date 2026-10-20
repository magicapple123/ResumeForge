// SPDX-License-Identifier: Apache-2.0
/** 首次使用「第一份交付」的三阶段进度：条件全部由真实数据驱动。
 *
 * 为什么不把"点过某个按钮"当完成：进度回答的是"你离第一份可交付简历还有多远"，
 * 只有台账/简历/岗位/资料这些**事实数据**能回答它；点击记录只会让进度说谎。
 * 阶段条件拆成纯函数（``computeActivationStages``）便于独立测试；hook 只负责
 * memo 与"数据未就绪"的空态，复用首页已取的 getStats / getProfile 数据。
 *
 * 审计口径（2026-10-13 生产审计 PR-19）：
 * - 「准备事实」不再只看台账/简历计数——只认真填写 profile 也可能一个事实都没有。
 *   资料侧的完成判定用后端 /api/profile 真实返回的**关键字段完整度**（姓名非空且
 *   联系方式电话/邮箱至少一项非空），不编造接口没有的数据；
 * - 「核实并交付」不再把"空台账"当"核实完成"：一条主张都没核实过（含台账为空）
 *   时该阶段不得显示完成，改以真实进度呈现（"台账为空"/"已核实 N/M 条主张"）。
 */
import { useMemo } from "react";
import type { Profile } from "../../types/profile";
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
  /** 真实进度文本（如"已核实 2/5 条主张"）；没有可量化的进度时不设。 */
  progress?: string;
  /** 仅未完成阶段携带；完成态不需要去向。 */
  cta?: ActivationStageCta;
}

/** 资料侧的事实就绪：后端 /api/profile 真实字段——姓名非空，且电话/邮箱至少一项非空。
 *
 * 只挑生成简历真正必需的关键字段：这两类是简历页眉的硬事实；其余字段（城市、
 * 意向等）选填，不作为"就绪"的门槛。
 */
export function isProfileFactsReady(profile: Profile | undefined | null): boolean {
  if (!profile) return false;
  const hasName = profile.name.trim().length > 0;
  const hasContact = profile.phone.trim().length > 0 || profile.email.trim().length > 0;
  return hasName && hasContact;
}

/** 阶段 1「准备事实」：资料关键字段齐了，或已有台账/简历事实，就算有了底子。 */
export function isFactsDone(stats: Stats, profile?: Profile | null): boolean {
  return isProfileFactsReady(profile) || stats.claim_count > 0 || stats.resume_count > 0;
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

/** 阶段 3「核实并交付」：有简历、台账非空且没有未核实的事实。
 *
 * 诚实口径（2026-10-13 审计修正）：**空台账不等于完成事实核实**——一条主张都没
 * 核实过（claim_count === 0，含从没建过台账）时不能显示"已完成"，否则进度在替
 * 用户说谎。同样，**交付动作本身不判定完成**——导出、投递都不改这个条件，因为
 * "投没投出去"取决于对方，不该让进度卡在用户控制不了的事上。
 */
export function isDeliverDone(stats: Stats): boolean {
  return stats.resume_count > 0 && stats.claim_count > 0 && stats.pending_claim_count === 0;
}

/** 阶段 3 的真实进度文本与 CTA：区分"台账为空 / 有未核实 / 全核实但没简历"三态。 */
function deliverProgressAndCta(stats: Stats): {
  progress?: string;
  cta?: ActivationStageCta;
} {
  const verified = stats.claim_count - stats.pending_claim_count;
  if (stats.claim_count === 0) {
    return {
      progress: "台账为空：还没有可核实的主张",
      cta: {
        label: "去事实台账录入主张",
        hint: "把要写进简历的话先记成一条，才谈得上核实",
        path: "/claims",
      },
    };
  }
  const progress = `已核实 ${verified}/${stats.claim_count} 条主张`;
  if (stats.pending_claim_count > 0) {
    return {
      progress,
      cta: {
        label: `核实 ${stats.pending_claim_count} 条待确认事实`,
        hint: "没核实的说法不会进简历",
        path: "/claims",
      },
    };
  }
  if (stats.resume_count === 0) {
    return {
      progress,
      cta: {
        label: "去简历中心生成或关联简历",
        hint: "事实都核实了，还差一份对着岗位的简历",
        path: "/resumes",
      },
    };
  }
  return { progress };
}

/** 由 stats 与 profile 计算三阶段（含未完成时的 CTA）。纯函数，可独立测试。 */
export function computeActivationStages(stats: Stats, profile?: Profile | null): ActivationStage[] {
  const factsDone = isFactsDone(stats, profile);
  const targetDone = isTargetDone(stats);
  const deliverDone = isDeliverDone(stats);
  const deliver = deliverProgressAndCta(stats);

  return [
    {
      key: "facts",
      title: "准备事实",
      description: "填好「我的资料」关键字段（姓名与联系方式），或先有台账/简历事实",
      done: factsDone,
      cta: factsDone
        ? undefined
        : {
            label: "去我的资料录入",
            hint: isProfileFactsReady(profile)
              ? "手动填写不需要模型"
              : "姓名与联系方式是生成简历的关键字段，先补全这两项",
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
      description: "把台账里的主张逐条核实，有简历后导出或投出",
      done: deliverDone,
      progress: deliver.progress,
      cta: deliverDone ? undefined : deliver.cta,
    },
  ];
}

/** 首页消费的进度 hook：stats 未就绪时返回空阶段（面板不渲染）。
 *
 * profile 未就绪（还在加载/加载失败）时不阻断渲染：阶段判定退回 stats 事实
 * （台账/简历计数），与"加载失败"由首页错误横幅另行提示的分工一致。
 */
export function useActivationProgress(
  stats: Stats | undefined,
  profile?: Profile | null,
): {
  stages: ActivationStage[];
  allDone: boolean;
} {
  return useMemo(() => {
    if (!stats) return { stages: [], allDone: false };
    const stages = computeActivationStages(stats, profile);
    return { stages, allDone: stages.every((stage) => stage.done) };
  }, [stats, profile]);
}
