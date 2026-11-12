// SPDX-License-Identifier: Apache-2.0
/**
 * 未收录清单的**一组**（5-A 第 2 部分：组头 + 一条一行 + 组底部按钮）。
 *
 * 为什么单独成文件：`ResumeCoverageNotes` 有 200 行预算，而"组头怎么排 / 前 5 条 + 展开 /
 * 按钮三分支"三件事都只服务于一组，留在父组件里会让父组件既管数据又管三种按钮。
 *
 * 三条产品口径（别在别处再实现一遍）：
 * - 组头 `分区名 · N 条` + **原因汇总徽标**（`与岗位无关 6 · 超出名额 2 · 模型未采用 1`）。
 *   数字之和 = 该组条数，所以用户不用逐条读就知道"为什么"。
 * - 默认只显示**前 5 条**，超出给「展开全部 N 条 / 收起」。展开状态是本地 state：它是一次
 *   "临时看清楚"的动作，不落库、不记忆。
 * - 按钮在**组底部右对齐**，不再跟在最后一条文字后面当正文的一部分。三分支由
 *   `resolveCoverageAction` 决定（append / revise / workbench），这里只负责画。
 */
import { Button, Tooltip } from "antd";
import { useState } from "react";
import { translate } from "../../../i18n";
import { RESUME_CATALOG_SECTION_LABEL_KEYS } from "../../../i18n/enum/resumeCatalog";
import { useI18n, useLocale } from "../../../i18n/i18nContext";
import {
  COVERAGE_REASON_DISPLAY_ORDER,
  coverageReasonLabelKey,
  DEFAULT_VISIBLE_ITEMS,
  type CoverageAction,
  type CoverageGroup,
} from "./coverageGroups";
import CoverageItemRow from "./CoverageItemRow";

interface Props {
  group: CoverageGroup;
  /** 该组该出哪个按钮（唯一判定入口见 `resolveCoverageAction`）。 */
  action: CoverageAction;
  /** 「补进简历」请求在飞：转圈并禁用，避免连点写出两条。 */
  appendPending?: boolean;
  /** 「补进简历」：把该组的 entry_ids 确定性写进正文。 */
  onAppend: (group: CoverageGroup) => void;
  /** 「AI 补上这段」：把拼好的修订指令交给弹窗。 */
  onRevise: (group: CoverageGroup) => void;
  /** 「去制作台添加」：宿主负责打开制作台。 */
  onOpenEditor: () => void;
}

export default function CoverageGroupCard({
  group,
  action,
  appendPending = false,
  onAppend,
  onRevise,
  onOpenEditor,
}: Props) {
  // 用了 `t()` 就必须订阅语言变化。
  useLocale();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // 只有超过阈值才有"展开/收起"：3 条的组不该出现一个点了没变化的按钮。
  const collapsible = group.items.length > DEFAULT_VISIBLE_ITEMS;
  const visibleItems =
    collapsible && !expanded ? group.items.slice(0, DEFAULT_VISIBLE_ITEMS) : group.items;
  // 分区名怎么显示（5-A）：
  // 后端下发的是**中文**分区名（`resume_labels.SECTION_TITLES`），与语言包的 zh 值逐字一致
  // （见 `i18n/enum/resumeCatalog` 的注释）。所以"能查语言包"的判据是：`section_label`
  // 恰好等于该分区的 zh 名。字段级 note（`项目「X」的亮点`、`项目「X」的技术栈`）不等，
  // 原样显示后端标签——那正是它们彼此区分、以及不并进 `项目经历` 的信息。
  // 自建板块没有目录键，同样走原文（分区名是用户数据，不翻译）。
  const catalogKey = RESUME_CATALOG_SECTION_LABEL_KEYS[group.section];
  const sectionLabel =
    catalogKey && group.sectionLabel === translate("zh-CN", catalogKey)
      ? t(catalogKey)
      : group.sectionLabel;
  /** 组头原因汇总：只列出真出现的那些原因，"未说明"排在最后。 */
  const reasonSummary = [
    ...COVERAGE_REASON_DISPLAY_ORDER.filter((reason) => group.reasonCounts[reason] > 0).map(
      (reason) =>
        t("resume.coverage.reasonCount", {
          label: t(coverageReasonLabelKey(reason)),
          count: group.reasonCounts[reason],
        }),
    ),
    ...(group.unknownCount > 0
      ? [
          t("resume.coverage.reasonCount", {
            label: t(coverageReasonLabelKey(null)),
            count: group.unknownCount,
          }),
        ]
      : []),
  ].join(t("resume.coverage.reasonSeparator"));

  return (
    <div className="resume-coverage-group">
      <div className="resume-coverage-group-head">
        <span>
          {t("resume.coverage.sectionCount", { label: sectionLabel, count: group.total })}
        </span>
        {reasonSummary ? <span className="resume-coverage-reasons">{reasonSummary}</span> : null}
      </div>
      <ul className="resume-coverage-items">
        {visibleItems.map((item) => (
          <CoverageItemRow
            key={item.name}
            name={item.name}
            reason={item.reason}
            // 只有混合原因的组才逐条补小徽标（纯因一组靠组头那一行就够了）。
            showReason={group.mixedReason}
          />
        ))}
      </ul>
      {collapsible ? (
        <Button
          type="link"
          size="small"
          className="resume-coverage-more"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("resume.coverage.collapse")
            : t("resume.coverage.expandAll", { count: group.items.length })}
        </Button>
      ) : null}
      <div className="resume-coverage-actions">
        {action === "append" ? (
          <Button
            size="small"
            type="primary"
            ghost
            loading={appendPending}
            disabled={appendPending}
            onClick={() => onAppend(group)}
          >
            {t("resume.coverage.append")}
          </Button>
        ) : null}
        {action === "revise" ? (
          <Button size="small" type="primary" ghost onClick={() => onRevise(group)}>
            {t("resume.coverage.revise")}
          </Button>
        ) : null}
        {action === "workbench" ? (
          <Tooltip title={t("resume.coverage.goWorkbenchHint")}>
            <Button size="small" onClick={() => onOpenEditor()}>
              {t("resume.coverage.goWorkbench")}
            </Button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
