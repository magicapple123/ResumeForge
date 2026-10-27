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
 * ## 选谁
 *
 * 目标集来自宿主：大纲多选优先（批量），否则用大纲/纸面单选的那一条。两者都没有时给
 * 一句"先去选内容"，而不是渲染一排按不动的按钮。
 *
 * ## 当前级别是读出来的
 *
 * 级别名不落库（见 `textLevels.ts` 头注释）；这里只显示反推结果：某个级别 / 自定义 /
 * 多个级别 / 跟随模板。显式覆盖的来源用 `StyleSourceTag`（"本条已调整"）说清，避免
 * 用户以为改的是整份简历。
 */
import { Button, Space, Typography } from "antd";
import type { ResumeLayout } from "../../../types";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  TEXT_LEVEL_LABELS,
  TEXT_LEVELS,
  applyTextLevel,
  clearTextLevel,
  readTextLevelState,
  type TextLevelId,
  type TextLevelState,
} from "../../../features/resume-layout/textLevels";
import { readStyleDomains } from "../../../features/resume-layout/styleOverrides";
import { isObjectId } from "../../../features/resume-document/identity";
import StyleSourceTag from "./StyleSourceTag";

interface Props {
  layout: ResumeLayout;
  /** 大纲多选集合（批量目标）；空 = 用 `selectedObjectId`。 */
  selected: readonly { id: string }[];
  /** 大纲/纸面单选的那一条。 */
  selectedObjectId: string | null;
  disabled?: boolean;
  /** 一次应用 = 一次提交（宿主负责历史与保存）。 */
  onChange: (layout: ResumeLayout) => void;
  /** 应用/恢复成功（宿主据此播 Toast）；level=null 表示恢复跟随模板。 */
  onApplied?: (result: { level: TextLevelId | null; count: number }) => void;
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
  selected,
  selectedObjectId,
  disabled = false,
  onChange,
  onApplied,
}: Props) {
  useLocale();
  // 只收合法稳定 id：对象覆盖的键必须是 W00/W01 形状，缺 id 的旧条目写不进去。
  const targets = (
    selected.length > 0
      ? selected.map((entry) => entry.id)
      : selectedObjectId
        ? [selectedObjectId]
        : []
  ).filter(isObjectId);
  const domains = readStyleDomains(layout.format_config);
  const state = readTextLevelState(domains, targets);
  // 显式覆盖（某个级别或手改过）才挂来源胶囊：跟随模板时那句"当前：跟随模板"已经说清来源。
  const explicit = state.kind === "level" || state.kind === "custom";

  if (targets.length === 0) {
    return <Typography.Text type="secondary">{t("typography.level.empty")}</Typography.Text>;
  }

  const apply = (level: TextLevelId) => {
    if (disabled) return;
    // 已是该级别且全部一致：不制造一次"看起来没变"的历史点。
    if (state.kind === "level" && state.level === level) return;
    onChange({ ...layout, format_config: applyTextLevel(layout.format_config, targets, level) });
    onApplied?.({ level, count: targets.length });
  };

  const restore = () => {
    if (disabled || state.kind === "inherit") return;
    onChange({ ...layout, format_config: clearTextLevel(layout.format_config, targets) });
    onApplied?.({ level: null, count: targets.length });
  };

  return (
    <section
      className="resume-typography-panel"
      aria-label={t("typography.level.groupAria")}
      data-text-level-bar="1"
    >
      <Space size={6} wrap>
        <Typography.Text strong>{t("typography.level.title")}</Typography.Text>
        <Typography.Text type="secondary">
          {t("typography.level.count", { count: targets.length })}
        </Typography.Text>
        <Typography.Text type="secondary">
          {t("typography.level.current", { level: currentLevelText(state) })}
        </Typography.Text>
        {explicit ? <StyleSourceTag source="object" /> : null}
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
