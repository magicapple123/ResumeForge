// SPDX-License-Identifier: Apache-2.0
/**
 * 「这些资料内容没有写进这份简历」的中性提示块（#3 / #5 / 5-A / 3-A）。
 *
 * **为什么单独成文件**：宿主 `ResumeDetailPreview` 贴着 500 行预算，而这一块是**派生数据
 * 的纯展示**——它只读 `coverage_notes` 与那几条从 `warnings` 里拆出来的旧版警告，动作
 * 都是"把用户带到能处理它的地方"（确定性补入 / 修订弹窗 / 制作台）。
 *
 * 与「疑似虚构」分开呈现是刻意的：岗位导向筛选把与岗位关键词交集不足的内容挡在生成之外，
 * 这是**正常结果**，资料本身一条都没丢；把它和虚构混成一面红色的墙，用户会以为数据坏了。
 *
 * 形态与上方「生成说明」一致（2026-11 问题 1）：`Collapse` + **不传 `defaultActiveKey`**，
 * 默认收起。这条提示是补充说明，展开态曾把真正的简历挤到首屏之外。折叠头用条数 `Tag`
 * 保留"还有 N 条没写进去"这一信息，`InfoCircleOutlined` 顶替原 `Alert` 的 `showIcon`。
 * 展开状态刻意不记忆（不落 localStorage）：每次打开都收起才符合"默认折叠"的语义。
 *
 * 2026-11（问题 8）：详情顶部把这块收进诊断条的 `Popover`，折叠外壳由诊断条承担，
 * 于是正文抽成 `ResumeCoverageNotesBody`——同一份渲染，只是不再自带一层 `Collapse`
 * （弹层里再套一层折叠＝要点两次）。聚合规则搬去 `coverageGroups.ts`（诊断条也要那个条数）。
 *
 * 5-A：一组内的多个名字不再拼成一段文字，改为一条一行（`CoverageGroupCard`），组头写
 * 原因汇总；分组键改成 `(section, section_label)`。
 * 3-A：按钮按 `resolveCoverageAction` 分三支——能确定性补入的自建板块「补进简历」，
 * 有可写字段的分区「AI 补上这段」，其余「去制作台添加」（AI 修订不能新增条目）。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { App, Button, Collapse, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { appendProfileEntries } from "../../../api/resumes";
import { useI18n } from "../../../i18n/i18nContext";
import type { ResumeCoverageNote, ResumeDetail } from "../../../types";
import CoverageGroupCard from "./CoverageGroupCard";
import {
  coverageSummaryCount,
  groupCoverageNotes,
  resolveCoverageAction,
  type CoverageGroup,
} from "./coverageGroups";

interface Props {
  /** 结构化的分区级清单（新生成的记录才有）。 */
  notes: ResumeCoverageNote[];
  /** 旧记录把未收录警告混在 `warnings` 文本里：按特征句拆出来的那几条。 */
  legacyWarnings: string[];
  /** 「AI 补上这段」：把拼好的指令交给宿主的修订弹窗。 */
  onRevise: (instructions: string) => void;
  /** 「去制作台添加」/「打开手动调整」：宿主负责关掉目标定位、打开编辑器。 */
  onOpenEditor: () => void;
  /** 3-A：当前简历 id（缺省时"补进简历"降级为"去制作台添加"）。 */
  resumeId?: number;
  /** 3-A：点按钮时的那一版，用于条件写（期间别处保存过就 409）。 */
  baseRevision?: number | null;
  /** 3-A：补入成功后的新简历，宿主据此刷新预览与清单。 */
  onAppended?: (detail: ResumeDetail) => void;
}

/**
 * 正文（不带折叠外壳）：诊断条的弹层直接用它。
 * 两类数据都空时返回 null——空壳会在弹层里留一块什么都没有的区域。
 */
export function ResumeCoverageNotesBody({
  notes,
  legacyWarnings,
  onRevise,
  onOpenEditor,
  resumeId,
  baseRevision = null,
  onAppended,
}: Props) {
  const { t } = useI18n();
  const { message } = App.useApp();
  /** 正在补入的那一组（`group.key`）：只锁这一组的按钮，别的组仍可操作。 */
  const [appendingKey, setAppendingKey] = useState<string | null>(null);
  if (notes.length === 0 && legacyWarnings.length === 0) return null;

  const groups = groupCoverageNotes(notes);
  // 没有 resumeId 或没有刷新回调时，"补进简历"点了也落不了库 → 一律降级成"去制作台添加"。
  const canAppend = resumeId !== undefined && onAppended !== undefined;

  /** 一句话把这条分区清单变成"只补这些、其余不动"的修订指令。 */
  const reviseInstructions = (group: CoverageGroup): string =>
    // i18n-ok: 喂给模型的修订指令（作为 prompt 保持中文，初值会带进修订弹窗）
    `请把资料中的以下内容补进这份简历的${group.sectionLabel}（只新增这些内容，其余部分保持不变）：` +
    group.names.map((name) => `「${name}」`).join("、") + // i18n-ok: 同上，模型 prompt 里的中文引号与顿号
    "。补充时使用这些条目在个人资料中的原文事实，不要虚构细节。"; // i18n-ok: 同上，模型 prompt

  /** 3-A：确定性补入。成功后宿主刷新简历，清单由后端修剪，不需要前端自己删条目。 */
  const handleAppend = async (group: CoverageGroup): Promise<void> => {
    if (resumeId === undefined || !onAppended) return;
    setAppendingKey(group.key);
    try {
      const result = await appendProfileEntries(resumeId, {
        sectionKey: group.rawSection,
        entryIds: group.entryIds,
        baseRevision,
      });
      if (result.appended.length > 0) {
        message.success(t("resume.coverage.appended", { count: result.appended.length }));
      }
      if (result.skipped.length > 0) {
        message.info(t("resume.coverage.skipped", { count: result.skipped.length }));
      }
      onAppended(result.resume);
    } catch (error) {
      // 后端给了可解释的失败（资料已删除 / 不在当前组 / 版本冲突）：ApiError.message 已是人话。
      message.error(
        error instanceof Error && error.message ? error.message : t("resume.coverage.appendFailed"),
      );
    } finally {
      setAppendingKey(null);
    }
  };

  return (
    // 05-1：列模板必须显式写 `minmax(0, 1fr)`。只写 `display: grid` 时隐式列是
    // `auto`，nowrap 的条目会把轨道撑到 742px（弹层 clientWidth 560 → scrollWidth 742），
    // 横向溢出后 `max-width: 100%` 也跟着失效。配合 `.resume-coverage-group{min-width:0}`
    // 双保险：一个管轨道上限，一个管子项最小宽度。
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 4 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("resume.coverage.intro")}
      </Typography.Text>
      {groups.map((group) => (
        <CoverageGroupCard
          key={group.key}
          group={group}
          action={resolveCoverageAction(group, canAppend)}
          appendPending={appendingKey === group.key}
          onAppend={(target) => {
            void handleAppend(target);
          }}
          onRevise={(target) => onRevise(reviseInstructions(target))}
          onOpenEditor={onOpenEditor}
        />
      ))}
      {legacyWarnings.map((warning) => (
        <Typography.Paragraph key={warning} style={{ margin: 0, fontSize: 13 }}>
          {warning}
        </Typography.Paragraph>
      ))}
      {notes.length > 0 && (
        <Space size={8} wrap>
          <Button size="small" onClick={onOpenEditor}>
            {t("resume.coverage.openEditor")}
          </Button>
        </Space>
      )}
    </div>
  );
}

export default function ResumeCoverageNotes(props: Props) {
  const { t } = useI18n();
  const summaryCount = coverageSummaryCount(props.notes, props.legacyWarnings);
  // 两类数据都空时整块不渲染：空壳会在每份简历的弹窗里多出一条什么都没有的提示条。
  if (props.notes.length === 0 && props.legacyWarnings.length === 0) return null;

  return (
    <Collapse
      size="small"
      style={{ marginBottom: 12 }}
      items={[
        {
          key: "coverage",
          label: (
            <Space size={8}>
              <InfoCircleOutlined />
              <span>{t("resume.coverage.title")}</span>
              <Tag style={{ marginInlineEnd: 0 }}>
                {t("resume.coverage.summary", { count: summaryCount })}
              </Tag>
            </Space>
          ),
          children: <ResumeCoverageNotesBody {...props} />,
        },
      ]}
    />
  );
}
