// SPDX-License-Identifier: Apache-2.0
/**
 * #15D 队列条目编辑器里的**单条简历建议**：
 * 「推荐简历：后端版（关键词覆盖 40% → 75%）[换用]」。
 *
 * 三处刻意的措辞/行为：
 * - 说「关键词覆盖」，不说「匹配度 / 参考分」：那是另一个口径（`match_score` 由匹配结论
 *   派生、不参与准入），两个数混着叫会让用户以为可以互相比较；
 * - `gain <= 0` **整条不显示**：没有收益的建议等于噪声，而且「换用」点了只会变差；
 * - 接口失败只退化成一行灰字，不挡保存：「换用」是加速器，手动选简历永远还在。
 */
import { Button, Space, Typography } from "antd";
import { useApi } from "../../../hooks/useApi";
import { getResumeFit } from "../../../api/applyInsights";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyResumeFitList } from "../../../types";
import { fetchResumeTitles, resumeTitleOf } from "./resumeTitles";

interface Props {
  /** 队列条目 id（不是岗位 id）。 */
  queueId: number;
  /** 点了「换用」：由编辑器把值写进表单（不在这里直接落库——保存仍由用户确认）。 */
  onApply: (resumeId: number) => void;
}

export default function ResumeFitHint({ queueId, onApply }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { data, error } = useApi<ApplyResumeFitList>(() => getResumeFit([queueId]), [queueId]);
  const { data: titles } = useApi<Record<number, string>>(() => fetchResumeTitles(), []);

  if (error) {
    return (
      <Typography.Text type="secondary">{t("applyQueue.insights.fit.hintError")}</Typography.Text>
    );
  }

  const fit = data?.items.find((item) => item.queue_id === queueId);
  // 没有建议、没有提升、或推荐的是同一份简历：都不显示（不制造"该做点什么"的错觉）。
  if (
    !fit ||
    fit.gain <= 0 ||
    fit.recommended_resume_id === null ||
    fit.recommended_resume_id === fit.current_resume_id
  ) {
    return null;
  }
  const recommendedId = fit.recommended_resume_id;

  return (
    <Space size={8} wrap className="apply-resume-fit-hint">
      <Typography.Text type="secondary">
        {t("applyQueue.insights.fit.recommendInline", {
          title: resumeTitleOf(titles ?? {}, recommendedId),
          from: Math.round(fit.current_coverage ?? 0),
          to: Math.round(fit.recommended_coverage ?? 0),
        })}
      </Typography.Text>
      <Button type="link" size="small" onClick={() => onApply(recommendedId)}>
        {t("applyQueue.insights.fit.swap")}
      </Button>
    </Space>
  );
}
