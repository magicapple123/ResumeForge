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
 *
 * CR-34 再拆一次（2026-11-25）：
 * - 面板只在 `shouldShowFirstDelivery`（简历数=0 且投递记录=0）时出现——有简历的人
 *   不该再看到"从零到第一份交付"；
 * - 第三阶段的完成改看**已投递**，未核实主张降级为「接下来做什么」里的一条，不再
 *   用"你还没交付"冒充待办。
 */
import { useMemo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
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

/** 阶段 3「交付」：只看"真的交出去过"——至少有一条投递成功记录（CR-34）。
 *
 * 旧口径要求"有简历 + 台账非空 + 没有未核实主张"，结果一份简历投出去十次，只要台账里
 * 还挂着一条待确认事实，进度就一直说"没交付"。现在拆开：
 *
 * - **未核实主张不阻塞**：它降级成首页「接下来做什么」里单独的一条（`pending_claim_count`），
 *   该核实的时候照样提醒，但不再冒充"你还没交付"；
 * - **导出没有独立计数**（导出是本地文件，服务端看不到），投递成功记录是唯一可观测的
 *   交付信号，所以以它为准。
 */
export function isDeliverDone(stats: Stats): boolean {
  return stats.latest_applications.length > 0;
}

/**
 * 新手三步面板的显示条件（CR-34）：**简历数 = 0 且投递记录 = 0**。
 *
 * 面板回答的是"从零到第一份交付"，对已经有简历/投递的人没有任何信息量——真实数据集
 * （22 份简历）里它长期挂在首页顶部，读起来像"你还没开始"，是在指责用户。
 *
 * 投递记录口径：投递成功的最近记录（`latest_applications`）或进行中的投递
 * （`stalled_application_count > 0` 说明至少有一条求职进度）。两者任一存在就说明
 * 用户已经跨过"从零到一"，面板退场；至于主张未核实，交给「接下来做什么」。
 */
export function shouldShowFirstDelivery(stats: Stats): boolean {
  if (stats.resume_count > 0) return false;
  if (stats.latest_applications.length > 0) return false;
  if (stats.stalled_application_count > 0) return false;
  return true;
}

/** 阶段 3 的真实进度文本与 CTA：区分"台账为空 / 有未核实 / 全核实但没简历"三态。 */
function deliverProgressAndCta(stats: Stats): {
  progress?: string;
  cta?: ActivationStageCta;
} {
  const verified = stats.claim_count - stats.pending_claim_count;
  if (stats.claim_count === 0) {
    return {
      progress: t("activationUi.deliver.progressEmpty"),
      cta: {
        label: t("activationUi.deliver.cta.labelEmpty"),
        hint: t("activationUi.deliver.cta.hintEmpty"),
        path: "/claims",
      },
    };
  }
  const progress = t("activationUi.deliver.progressVerified", {
    verified,
    total: stats.claim_count,
  });
  if (stats.pending_claim_count > 0) {
    return {
      progress,
      cta: {
        label: t("activationUi.deliver.cta.labelPending", {
          count: stats.pending_claim_count,
        }),
        hint: t("activationUi.deliver.cta.hintPending"),
        path: "/claims",
      },
    };
  }
  if (stats.resume_count === 0) {
    return {
      progress,
      cta: {
        label: t("activationUi.deliver.cta.labelNoResume"),
        hint: t("activationUi.deliver.cta.hintNoResume"),
        path: "/resumes",
      },
    };
  }
  return { progress };
}

/** 由 stats 与 profile 计算三阶段（含未完成时的 CTA）。不依赖 React，可独立测试；
 * 文案在函数体内从语言包取（`t()` 不在模块作用域求值）。 */
export function computeActivationStages(stats: Stats, profile?: Profile | null): ActivationStage[] {
  const factsDone = isFactsDone(stats, profile);
  const targetDone = isTargetDone(stats);
  const deliverDone = isDeliverDone(stats);
  const deliver = deliverProgressAndCta(stats);

  return [
    {
      key: "facts",
      title: t("activationUi.facts.title"),
      description: t("activationUi.facts.description"),
      done: factsDone,
      cta: factsDone
        ? undefined
        : {
            label: t("activationUi.facts.cta.label"),
            hint: isProfileFactsReady(profile)
              ? t("activationUi.facts.cta.hintReady")
              : t("activationUi.facts.cta.hintMissing"),
            path: "/profile",
          },
    },
    {
      key: "target",
      title: t("activationUi.target.title"),
      description: t("activationUi.target.description"),
      done: targetDone,
      cta: targetDone
        ? undefined
        : stats.job_count === 0
          ? {
              label: t("activationUi.target.cta.labelNoJobs"),
              hint: t("activationUi.target.cta.hintNoJobs"),
              path: "/jobs",
            }
          : {
              label: t("activationUi.target.cta.labelWithJob"),
              hint: t("activationUi.target.cta.hintWithJob"),
              path: "/resumes",
            },
    },
    {
      key: "deliver",
      title: t("activationUi.deliver.title"),
      description: t("activationUi.deliver.description"),
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
  const locale = useLocale();
  return useMemo(() => {
    // 阶段文案随界面语言重算：t() 读 localeStore，locale 必须进依赖。
    void locale;
    if (!stats) return { stages: [], allDone: false };
    const stages = computeActivationStages(stats, profile);
    return { stages, allDone: stages.every((stage) => stage.done) };
  }, [stats, profile, locale]);
}
