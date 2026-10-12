/**
 * 单个岗位加入投递队列的确认链（自 JobsPage 拆出以守行数预算）：
 * 冲突时按原因分流——站点不支持的「仍然加入」不给、未分析/真实缺口逐级确认后重试。
 */
import { App } from "antd";
import { useState } from "react";
import { addToQueue, QueueConflictError } from "../../api/apply";
import type { Job } from "../../types";

export function useJobQueue() {
  const { message, modal } = App.useApp();
  const [queueJobId, setQueueJobId] = useState<number | null>(null);

  // 确认弹窗的 onOk 会再次调用自身（带确认标记跳过弹窗）：用函数声明利用提升，
  // 避免递归引用 useCallback 常量（Compiler 的 immutability 规则会报"先使用后声明"）。
  async function addJobToQueue(
    job: Job,
    confirm: { unanalyzed?: boolean; realGap?: boolean } = {},
  ) {
    setQueueJobId(job.id);
    try {
      await addToQueue([
        {
          job_id: job.id,
          confirm_unanalyzed: confirm.unanalyzed,
          confirm_real_gap: confirm.realGap,
        },
      ]);
      message.success("已加入投递台队列");
    } catch (err) {
      if (err instanceof QueueConflictError) {
        const detail = err.detail;
        if (detail.site_unsupported) {
          // 这一类**没有"仍然加入"的选项**：确认也放行不了（投递时定位不到站点），
          // 所以只给一个必须点掉的提示，而不是给个按钮让人以为可以强行通过。
          modal.warning({
            title: "这个岗位不能自动投递",
            content: detail.message,
            okText: "知道了",
          });
        } else if (detail.unanalyzed) {
          modal.confirm({
            title: "该岗位还没做过匹配分析",
            content: "建议先做「匹配度分析」。也可以直接加入队列，投递前仍会再核对一次。",
            okText: "仍然加入队列",
            cancelText: "取消",
            onOk: () => addJobToQueue(job, { unanalyzed: true }),
          });
        } else if (detail.gaps && detail.gaps.length > 0) {
          modal.confirm({
            title: "该岗位存在真实缺口，默认不投",
            content: `匹配分析判定你确实不具备这些要求：${detail.gaps.join("、")}。确认仍要投递该岗位吗？`,
            okText: "确认仍然投递",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => addJobToQueue(job, { realGap: true }),
          });
        } else {
          message.warning(detail.message);
        }
      } else {
        message.error(err instanceof Error ? err.message : "加入投递台失败");
      }
    } finally {
      setQueueJobId(null);
    }
  }

  // 每次渲染返回同一个函数声明（组件内函数声明就是稳定的调用入口）；
  // 递归的确认链靠声明提升自引用，无需 useCallback。
  return { addJobToQueue, queueJobId };
}
