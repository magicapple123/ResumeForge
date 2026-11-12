// SPDX-License-Identifier: Apache-2.0
/**
 * 「结构」页签里的**未收录资料**组（#24 24D）。
 *
 * ## 为什么放在结构页签，而不是左栏再加第四个入口
 *
 * 「补进来 / 移出去」本身就是**结构**操作：一条资料没进简历，下一步要么补进某个板块、
 * 要么去中栏对应板块改写。放在「本份简历结构」里，用户点完「补进简历」还能立刻在下面
 * 的结构树上看见新增的条目——这条反馈闭环在弹层里给不出来。
 *
 * ## 数据为什么不从上往下传
 *
 * 清单在记录的 `coverage_notes` 上（`ResumeDetail` 的字段），而制作台外壳（`ResumeWorkbenchV2`）
 * 只拿到 `document` / `layout` / `resumeId`，没有 detail。这里按 `resumeId` **自取一次**
 * 详情：一次 GET、只在挂载与补入成功后各跑一次，不动外壳契约（那个文件贴着 500 行预算）。
 *
 * ## 两条必须说清楚的边界
 *
 * 1. **统计口径是"已保存的版本"**：用户在中栏改的草稿不会出现在这里。所以组里常驻一句
 *    说明，并明说"补进简历会写回记录"——不写清楚，用户会以为点了没生效。
 * 2. **「AI 补上这段」在这里降级成提示**：修订弹窗挂在预览卡宿主上，制作台里没有它的
 *    上下文；这一类分区（技能 / 语言 / 自我介绍）在文档里已经有可写字段，直接去中栏改
 *    比再开一个弹窗更顺手。
 */
import { App, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appendProfileEntries, getResume } from "../../../api/resumes";
import { useI18n } from "../../../i18n/i18nContext";
import type { ResumeCoverageNote } from "../../../types";
import CoverageGroupCard from "../document/CoverageGroupCard";
import {
  coverageSummaryCount,
  groupCoverageNotes,
  resolveCoverageAction,
  type CoverageGroup,
} from "../document/coverageGroups";

export interface CoverageStructureGroupProps {
  /** 记录 id；缺省（只读宿主 / 生成中的临时预览）时整组不渲染。 */
  resumeId?: number | null;
  /** 宿主当前的兜底版本号（详情自己也会带一份，取详情那份为准）。 */
  revision?: number | null;
  /** 提示出口（宿主已接 antd message）。 */
  onNotify?: (message: string) => void;
}

export default function CoverageStructureGroup({
  resumeId,
  revision,
  onNotify,
}: CoverageStructureGroupProps) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const [notes, setNotes] = useState<ResumeCoverageNote[]>([]);
  /** 详情里那一份 revision：条件写要用"读清单时的版本"，不是宿主的旧值。 */
  const [recordRevision, setRecordRevision] = useState<number | null>(null);
  /** 正在补入的那一组（只锁这一组的按钮，别的组仍可操作）。 */
  const [appendingKey, setAppendingKey] = useState<string | null>(null);

  const notify = useCallback(
    (text: string) => {
      if (onNotify) onNotify(text);
      else message.info(text);
    },
    [message, onNotify],
  );

  /** 读一次清单；`alive()` 为假时不再写 state（组件已卸载 / resumeId 换人）。 */
  const load = useCallback(
    async (alive: () => boolean) => {
      if (resumeId == null) return;
      try {
        const detail = await getResume(resumeId);
        if (!alive()) return;
        setNotes(detail.coverage_notes ?? []);
        setRecordRevision(detail.revision ?? null);
      } catch {
        // 读不到清单不该让结构页签变红：这一组本来只是"补充说明"，失败就不显示。
        if (alive()) setNotes([]);
      }
    },
    [resumeId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const groups = useMemo(() => groupCoverageNotes(notes), [notes]);
  const total = useMemo(() => coverageSummaryCount(notes, []), [notes]);

  /** 确定性补入：服务端会把补进去的几条从 `coverage_notes` 里摘掉，重读即少一条。 */
  const handleAppend = useCallback(
    async (group: CoverageGroup) => {
      if (resumeId == null) return;
      setAppendingKey(group.key);
      try {
        const result = await appendProfileEntries(resumeId, {
          sectionKey: group.rawSection,
          entryIds: group.entryIds,
          // 读清单时的那一版：期间别处保存过就 409，不静默覆盖。
          baseRevision: recordRevision ?? revision ?? null,
        });
        if (result.appended.length > 0) {
          notify(t("resume.coverage.appended", { count: result.appended.length }));
        }
        if (result.skipped.length > 0) {
          notify(t("resume.coverage.skipped", { count: result.skipped.length }));
        }
        // 后端已修剪清单：重读一次，条数随之减 1（不要在前端自己删，口径只有后端一份）。
        await load(() => true);
      } catch (error) {
        message.error(
          error instanceof Error && error.message
            ? error.message
            : t("resume.coverage.appendFailed"),
        );
      } finally {
        setAppendingKey(null);
      }
    },
    [load, message, notify, recordRevision, resumeId, revision, t],
  );

  if (resumeId == null) return null;
  // 空清单时整组不渲染（含"还没读回来"的那一帧）：结构页签不该为 0 条留一块空壳。
  if (total === 0) return null;
  return (
    <section className="resume-wb-coverage" aria-label={t("resume.diagnostics.entry.coverage")}>
      <div className="resume-wb-coverage-head">
        <Typography.Text strong>{t("resume.coverage.title")}</Typography.Text>
        <Tag style={{ marginInlineEnd: 0 }}>{t("resume.coverage.summary", { count: total })}</Tag>
      </div>
      <Typography.Text type="secondary" className="resume-wb-coverage-hint">
        {t("workbench.coverage.savedHint")}
      </Typography.Text>
      {groups.map((group) => (
        <CoverageGroupCard
          key={group.key}
          group={group}
          action={resolveCoverageAction(group, true)}
          appendPending={appendingKey === group.key}
          onAppend={(target) => {
            void handleAppend(target);
          }}
          // 「AI 补上这段」在制作台里没有修订弹窗可用：如实指到中栏，不假装能做。
          onRevise={() => notify(t("workbench.coverage.reviseHint"))}
          onOpenEditor={() => notify(t("workbench.coverage.reviseHint"))}
        />
      ))}
    </section>
  );
}
