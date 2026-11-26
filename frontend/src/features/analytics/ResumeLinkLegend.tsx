// SPDX-License-Identifier: Apache-2.0
/** 投递/进度口径图例（T32）：把「含外部简历」写在数字旁边，而不是藏进 Tooltip。
 *
 * 为什么需要这一行：投递总量 / 漏斗 / 面试率 / 渠道转化 / 趋势这些**按行计数**的指标
 * 从来不看关联字段，所以"用内部简历投的"和"用外部原件投的"算在同一条记录里。数字本身
 * 没错，但用户看不见这件事——外部简历里明明上传了好几份、进度里却像是"从来没投过外部
 * 简历"，那就成了口径歧义。把三个数（内部 / 外部 / 未关联）摊开写，读者可以就地核对：
 * `内部 + 外部 = 关联总数`，`总投递 - 关联总数 = 未关联`。
 *
 * 三个数全部来自后端同一次聚合（`track_internal_resume_linked_count` /
 * `track_external_resume_linked_count` / `track_resume_linked_count`），前端不重算
 * 口径——只在"未关联"这一格用 `total_applications - linked` 求差，且**夹到 0**：
 * 历史脏数据（两条关联同时存在）不会把这个数字渲染成负数。
 */
import { Flex, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard } from "../../types";

interface Props {
  data: AnalyticsDashboard;
  /** 紧凑模式：用在卡片里、与其它说明并排时压掉上边距。 */
  compact?: boolean;
}

export default function ResumeLinkLegend({ data, compact = false }: Props) {
  // 模块级 t()：订阅语言变化，否则切语言后这一行不重渲染。
  useLocale();
  const unlinked = Math.max(0, data.total_applications - data.track_resume_linked_count);
  return (
    <Flex
      wrap
      align="center"
      gap={8}
      style={{ marginTop: compact ? 0 : 12 }}
      className="analytics-resume-link-legend"
      data-testid="analytics-resume-link-legend"
    >
      <Tag color="blue">{t("analyticsPage.resumeLink.includesExternal")}</Tag>
      <Typography.Text type="secondary">
        {t("analyticsPage.resumeLink.legend", {
          internal: data.track_internal_resume_linked_count,
          external: data.track_external_resume_linked_count,
          none: unlinked,
        })}
      </Typography.Text>
    </Flex>
  );
}
