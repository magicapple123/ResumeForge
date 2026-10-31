// SPDX-License-Identifier: Apache-2.0
/**
 * W07-TL「文字级别」工具条：把选中的条目/内容套用固定级别（一级/二级/三级标题、正文、
 * 次要说明），并显示当前级别与来源。
 *
 * ## 复用而不是新造
 *
 * 应用级别走 `features/resume-layout/textLevels` → 既有的对象级覆盖
 * （`format_config.objects[<id>]`）。一次点击只调**一次**宿主的 layout 提交（= W03 历史
 * 的一步），不新增保存链路；"恢复跟随模板"是删键而不是写默认值。
 *
 * ## 选谁 / 作用范围
 *
 * 目标集来自宿主：大纲多选优先（批量），否则用大纲/纸面单选的那一条。两者都没有时给
 * 一句"先去选内容"，而不是渲染一排按不动的按钮。
 *
 * W3：工具条带「作用范围」选择——默认"整个条目"（写 objects 域，与之前逐字节一致），
 * 也可以只作用于条目标题 / 正文 / 说明（写 object_roles 域，只改该角色）。当前级别的
 * 显示与"恢复跟随模板"都按所选范围读取/清除，两个范围互不覆盖。
 *
 * ## 当前级别是读出来的
 *
 * 级别名不落库（见 `textLevels.ts` 头注释）；这里只显示反推结果：某个级别 / 自定义 /
 * 多个级别 / 跟随模板。显式覆盖的来源用 `StyleSourceTag`（"本条已调整"）说清，避免
 * 用户以为改的是整份简历。
 */
import { Button, Segmented, Space, Typography } from "antd";
import { useState } from "react";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  TEXT_LEVEL_LABELS,
  TEXT_LEVEL_SCOPES,
  TEXT_LEVEL_SCOPE_HINTS,
  TEXT_LEVEL_SCOPE_LABELS,
  TEXT_LEVELS,
  applyTextLevelToScope,
  clearTextLevelScope,
  readTextLevelState,
  textLevelScopeRole,
  type TextLevelId,
  type TextLevelScope,
  type TextLevelState,
} from "../../../features/resume-layout/textLevels";
import { readStyleDomains } from "../../../features/resume-layout/styleOverrides";
import { OBJECT_ID_PATTERN } from "../../../features/resume-document/normalize";
import { scopeForDocumentPath } from "./v2Selection";
import StyleSourceTag from "./StyleSourceTag";

interface Props {
  layout: ResumeLayout;
  /** v2 文档：只用来把纸面路径（`section.entryId.itemId`）换成条目 id 与作用范围。 */
  document: ResumeDocument;
  /** 大纲多选集合（批量目标）；空 = 用 `selectedObjectId`。label 用于状态行指名片条目。 */
  selected: readonly { id: string; label?: string }[];
  /** 大纲/纸面单选的那一条。 */
  selectedObjectId: string | null;
  /** 单选条目的显示名（多选为空时也能在状态行指名）。 */
  selectedLabel?: string;
  disabled?: boolean;
  /** 一次应用 = 一次提交（宿主负责历史与保存）。 */
  onChange: (layout: ResumeLayout) => void;
  /** 应用/恢复成功（宿主据此播 Toast）；level=null 表示恢复跟随模板。 */
  onApplied?: (result: { level: TextLevelId | null; count: number }) => void;
  /**
   * 纸面上最后点中的字段路径（`data-resume-path`）。
   *
   * 只用来推**默认作用范围**：点"上海财经大学"（`education.0.school`）就落到"条目标题"，
   * 点一条成果就落到"正文"。用户随后手动改的范围在同一个字段上保持不动（依赖只有路径）。
   */
  pickedPath?: string | null;
}

/** 当前级别 → 界面文案；"跟随模板"等状态不是级别名，单独走词条。 */
function currentLevelText(state: TextLevelState): string {
  if (state.kind === "level") return t(TEXT_LEVEL_LABELS[state.level]);
  if (state.kind === "custom") return t("typography.level.currentCustom");
  if (state.kind === "mixed") return t("typography.level.currentMixed");
  return t("typography.level.currentInherit");
}

export default function TextLevelBar({
  layout,
  document,
  selected,
  selectedObjectId,
  selectedLabel,
  disabled = false,
  onChange,
  onApplied,
  pickedPath = null,
}: Props) {
  useLocale();
  // 作用范围默认跟着纸面点中的字段走（点标题→条目标题、点成果→正文），推不出来才是
  // "整个条目"。用户的**手动选择**记在 `manual` 里并带上当时那条路径：路径一变就自动
  // 失效、回到新字段推出的范围（不用 effect 同步，也就不存在"渲染后改 state"的抖动）。
  const [manual, setManual] = useState<{ path: string | null; scope: TextLevelScope } | null>(null);
  const defaultScope = scopeForDocumentPath(document, pickedPath);
  const scope = manual && manual.path === pickedPath ? manual.scope : defaultScope;
  const scopeRole = textLevelScopeRole(scope);
  // 只收合法稳定 id：对象覆盖的键必须是 W00/W01 形状，缺 id 的旧条目写不进去。
  const targets = (
    selected.length > 0
      ? selected.map((entry) => entry.id)
      : selectedObjectId
        ? [selectedObjectId]
        : []
  ).filter((id) => OBJECT_ID_PATTERN.test(id));
  const domains = readStyleDomains(layout.format_config);
  const state = readTextLevelState(domains, targets, scopeRole);
  // 显式覆盖（某个级别或手改过）才挂来源胶囊：跟随模板时那句"当前：跟随模板"已经说清来源。
  const explicit = state.kind === "level" || state.kind === "custom";

  if (targets.length === 0) {
    return <Typography.Text type="secondary">{t("typography.level.empty")}</Typography.Text>;
  }

  // Q13：状态行先说"在改哪一条/哪几条"，再说级别；「作用于 1 条」不指名会被误读。
  const singleLabel = targets.length === 1 ? (selected[0]?.label ?? selectedLabel)?.trim() : "";
  const targetName =
    singleLabel && singleLabel.length > 0
      ? singleLabel
      : t("typography.level.statusMany", { count: targets.length });

  const apply = (level: TextLevelId) => {
    if (disabled) return;
    // 已是该级别且全部一致：不制造一次"看起来没变"的历史点。
    if (state.kind === "level" && state.level === level) return;
    onChange({
      ...layout,
      format_config: applyTextLevelToScope(layout.format_config, targets, scopeRole, level),
    });
    onApplied?.({ level, count: targets.length });
  };

  const restore = () => {
    if (disabled || state.kind === "inherit") return;
    onChange({
      ...layout,
      format_config: clearTextLevelScope(layout.format_config, targets, scopeRole),
    });
    onApplied?.({ level: null, count: targets.length });
  };

  return (
    <section
      className="resume-typography-panel"
      aria-label={t("typography.level.groupAria")}
      data-text-level-bar="1"
    >
      {/* Q13：外层分组标题已经叫「文字级别」，这里不再重复一个同名标题；改成状态行：
          在改哪一条（目标）+ 当前级别 + 来源胶囊。 */}
      <Space size={6} wrap data-text-level-status="1">
        <Typography.Text strong>
          {t("typography.level.status", { name: targetName })}
        </Typography.Text>
        <Typography.Text type="secondary">
          {t("typography.level.current", { level: currentLevelText(state) })}
        </Typography.Text>
        {explicit ? <StyleSourceTag source="object" /> : null}
      </Space>
      <Space orientation="vertical" size={2} style={{ width: "100%" }} data-text-level-scope="1">
        <Space size={6} wrap>
          <Typography.Text type="secondary">{t("typography.level.scope.label")}</Typography.Text>
          <Segmented
            size="small"
            value={scope}
            disabled={disabled}
            aria-label={t("typography.level.scope.aria")}
            options={TEXT_LEVEL_SCOPES.map((value) => ({
              value,
              label: t(TEXT_LEVEL_SCOPE_LABELS[value]),
            }))}
            onChange={(value) => setManual({ path: pickedPath, scope: value as TextLevelScope })}
          />
        </Space>
        {/* 段控下方常驻一句范围说明：只靠标签解释不了"这次到底动了哪些字"。 */}
        <Typography.Text type="secondary">{t(TEXT_LEVEL_SCOPE_HINTS[scope])}</Typography.Text>
      </Space>
      <Space size={6} wrap role="group" aria-label={t("typography.level.title")}>
        {TEXT_LEVELS.map((level) => {
          const active = state.kind === "level" && state.level === level;
          return (
            <Button
              key={level}
              size="small"
              type={active ? "primary" : "default"}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => apply(level)}
            >
              {t(TEXT_LEVEL_LABELS[level])}
            </Button>
          );
        })}
        <Typography.Link
          role="button"
          tabIndex={0}
          aria-disabled={disabled || state.kind === "inherit" || undefined}
          onClick={restore}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            restore();
          }}
        >
          {t("typography.level.restore")}
        </Typography.Link>
      </Space>
      <Typography.Text type="secondary">{t("typography.level.hint")}</Typography.Text>
    </section>
  );
}
