// SPDX-License-Identifier: Apache-2.0
/**
 * 未收录清单的**一行**（5-A 第 2 部分：一条一行）。
 *
 * 为什么单独成文件：`ResumeCoverageNotes` / `CoverageGroupCard` 都有行数预算，而这一行
 * 承载两条独立的展示规则，写回去会把父组件撑成"什么都在里面"：
 * - 长条目（> {@link LONG_ITEM_CHARS} 字符）单行省略 + Tooltip 全文。项目亮点这类整句
 *   折三行是最刺眼的问题，而省略必须配 Tooltip，否则等于把内容藏起来。
 * - 只有**混合原因**的组才在条目末尾补一枚小徽标（纯色小字）。给 9 条内容贴 9 个标签
 *   是纯噪音——原因的主要出口是组头汇总。
 */
import { Tooltip } from "antd";
import { useI18n, useLocale } from "../../../i18n/i18nContext";
import { coverageReasonLabelKey, LONG_ITEM_CHARS, type CoverageItemReason } from "./coverageGroups";

interface Props {
  /** 资料条目的身份名（后端下发的原文，不裁剪、不改写）。 */
  name: string;
  /** 这条为什么没写进简历；`null` = 未说明。 */
  reason: CoverageItemReason;
  /** 仅混合原因的组传 true：纯因一组时不逐条贴标签。 */
  showReason?: boolean;
}

export default function CoverageItemRow({ name, reason, showReason = false }: Props) {
  // 用了 `t()` 就必须订阅语言变化，否则切语言后这一行不重渲染。
  useLocale();
  const { t } = useI18n();
  // 引号口径与旧版提示块一致（`resume.coverage.item`），只是不再用「、」拼成一段。
  const label = t("resume.coverage.item", { name });
  const text = <span className="resume-coverage-item">{label}</span>;
  // 阈值按**原始名字**长度判断（不含引号），这样阈值本身与文案语言无关。
  const truncated = name.length > LONG_ITEM_CHARS;
  return (
    <li>
      {truncated ? <Tooltip title={label}>{text}</Tooltip> : text}
      {showReason ? (
        <span className="resume-coverage-item-reason">{t(coverageReasonLabelKey(reason))}</span>
      ) : null}
    </li>
  );
}
