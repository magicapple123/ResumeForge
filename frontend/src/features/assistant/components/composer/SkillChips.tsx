// SPDX-License-Identifier: Apache-2.0
/**
 * 对话技能（T14）的两块视图 + 一份预算口径：
 *
 * - `SkillChips`（默认导出）：输入框上方**已启用**技能的 chip 行。R06-A 之后它只在已选时
 *   出现——空态那枚「+ 技能」虚线按钮收进了工具栏最左的 `+` 面板（`composer/AddMenu.tsx`）；
 * - `SkillPicker`：勾选列表 + 「本对话 N 个 · X / 12,000 字」预算行 + 工作台入口，
 *   作为 `+` 面板的技能二级。**同一个组件**给两处用，预算口径不会分叉（R04 正在修这块）。
 *
 * chip 与列表是同一份数据源（selected 的 id 集合），所以"列表里勾掉一个 chip 立刻少一枚、
 * chip 上 × 点掉列表对应项立刻取消勾选"是同一个状态的两种视图，不是两套逻辑。
 *
 * 被截断的技能（提示词超出本对话预算）用琥珀色描边 + tooltip 说明，让用户知道
 * "它没有完整生效"，而不是以为技能坏了。R05：tooltip 里的字数直接取后端下发的
 * `budget.per_skill`（本组件**不重算预算**——重算等于把后端的均分/截断规则复制一份，
 * 两边一旦漂移，提示里的数字就是错的）。
 */

import { CloseOutlined, ExperimentOutlined } from "@ant-design/icons";
import { Button, Checkbox, Tag, Tooltip, Typography } from "antd";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { formatCount } from "../../../skills/skillLimits";
import type {
  ConversationSkillBudget,
  ConversationSkillItem,
  ConversationSkillLoadItem,
} from "../../../../api/conversationSkills";
import type { AssistantSkill } from "../../../../types";
import "../../../../styles/assistant-skills.css";

function budgetText(count: number, budget: ConversationSkillBudget | null): string {
  if (!budget) return t("conversationSkills.menu.budgetPending", { count });
  return t("conversationSkills.menu.budget", {
    count,
    used: formatCount(budget.used_chars),
    limit: formatCount(budget.limit_chars),
  });
}

/**
 * 一个"没完整加载"的技能的说明文案。
 *
 * 三种情形（明细来自后端，前端只做三选一）：
 * - 整块跳过（`loaded_chars === 0`）→ 说"整块未加载"，别给用户看"前 0 字"；
 * - 被截断 → 说清"只加载了前 N 字 / 共 M 字"，N 与 M 都来自后端；
 * - 没有明细（草稿态 / 升级前的后端响应）→ 退回不带数字的通用说明，而不是显示 0。
 *
 * 只在调用方已确认该技能"没完整加载"时才会被调用：完整加载的技能不该有这个 tooltip。
 */
function truncationHint(detail: ConversationSkillLoadItem | undefined): string {
  if (!detail) return t("conversationSkills.chip.truncatedHint");
  if (detail.loaded_chars <= 0) return t("conversationSkills.chip.skippedHint");
  return t("conversationSkills.chip.truncatedCount", {
    loaded: formatCount(detail.loaded_chars),
    requested: formatCount(detail.requested_chars),
  });
}

/** 菜单 → 请求里的 skill 对象：chip 上的 × 只有 id+name，回 catalog 找完整对象。 */
function findSkill(
  catalog: AssistantSkill[],
  id: number,
  name: string,
  description = "",
): AssistantSkill {
  return (
    catalog.find((item) => item.id === id) ?? {
      id,
      name,
      description,
      enabled: true,
      source_name: "",
      prompt_chars: 0,
      files: [],
      updated_at: "",
    }
  );
}

/** #31D/#31F：自动生成且尚未验证的技能不能启用（后端会 409，这里提前禁用并说明）。 */
function isPendingSkill(skill: AssistantSkill): boolean {
  return Boolean(skill.generated) && skill.validation_status === "pending";
}

export interface SkillPickerProps {
  /** 技能库（勾选列表）。 */
  catalog: AssistantSkill[];
  /** 本会话已启用（草稿态 = 暂存）的技能，按启用顺序。 */
  selected: ConversationSkillItem[];
  /** 注入预算；草稿态为 null（还没有会话，服务端算不了）。 */
  budget: ConversationSkillBudget | null;
  /** 技能库是否已加载（没加载完不该说"还没有技能"）。 */
  loaded: boolean;
  /** 正在切换的技能 id（防连点）。 */
  togglingId: number | null;
  /** 发送中禁用全部交互（不能边发边改技能集合）。 */
  disabled: boolean;
  onToggle: (skill: AssistantSkill, enabled: boolean) => void;
  onManage: () => void;
}

/**
 * 技能勾选列表 + 预算行 + 工作台入口：输入区 `+` 面板的技能二级。
 *
 * 底部那一行左侧是「打开工作台」，右侧是本对话预算（>80% 黄、>100% 红）。
 */
export function SkillPicker({
  catalog,
  selected,
  budget,
  loaded,
  togglingId,
  disabled,
  onToggle,
  onManage,
}: SkillPickerProps) {
  useLocale();
  const selectedIds = new Set(selected.map((item) => item.id));
  const overBudget = budget !== null && budget.used_chars > budget.limit_chars;
  const nearBudget = budget !== null && budget.used_chars > budget.limit_chars * 0.8;

  return (
    <div className="assistant-skill-picker">
      <span className="assistant-skill-menu-hint">{t("conversationSkills.menu.hint")}</span>
      {catalog.length === 0 ? (
        <span className="assistant-skill-menu-hint">
          {loaded ? t("conversationSkills.menu.empty") : t("common.loading.content")}
        </span>
      ) : (
        <div
          className="assistant-skill-picker-list"
          role="group"
          aria-label={t("composerAddMenu.section.skills")}
        >
          {catalog.map((skill) => {
            // Pending skill: block enabling it here (already-linked history may still be removed).
            const pending = isPendingSkill(skill) && !selectedIds.has(skill.id);
            return (
              <label key={skill.id} className="assistant-skill-picker-option">
                <Checkbox
                  checked={selectedIds.has(skill.id)}
                  disabled={disabled || togglingId === skill.id || pending}
                  onChange={(event) => onToggle(skill, event.target.checked)}
                />
                {/* #32: the icon is the row's second column (same line as the name, does not
                  squeeze the description); `aria-hidden` keeps the accessible name as the name text. */}
                <ExperimentOutlined className="assistant-skill-picker-icon" aria-hidden="true" />
                <span className="assistant-skill-option-text">
                  <span className="assistant-skill-option-name">{skill.name}</span>
                  {skill.description ? (
                    <span className="assistant-skill-option-desc">{skill.description}</span>
                  ) : null}
                  {isPendingSkill(skill) ? (
                    <span className="assistant-skill-option-desc">
                      {t("conversationSkills.menu.pendingBadge")}
                      {t("conversationSkills.menu.pendingHint")}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="assistant-skill-menu-footer">
        <Typography.Link onClick={onManage} disabled={disabled}>
          {t("conversationSkills.action.manage")}
        </Typography.Link>
        <span
          className={`assistant-skill-budget${overBudget ? " is-over" : nearBudget ? " is-near" : ""}`}
        >
          {budgetText(selected.length, budget)}
        </span>
      </div>
    </div>
  );
}

export interface SkillChipsProps {
  /** 技能库（chip 上的 × 要按 id 找回完整对象）。 */
  catalog: AssistantSkill[];
  /** 本会话已启用的技能；为空时整行不渲染。 */
  selected: ConversationSkillItem[];
  /** 注入预算：只用来判断哪些 chip 被截断。 */
  budget: ConversationSkillBudget | null;
  /** 正在切换的技能 id（防连点）。 */
  togglingId: number | null;
  /** 发送中禁用全部交互。 */
  disabled: boolean;
  onToggle: (skill: AssistantSkill, enabled: boolean) => void;
}

/** 输入框上方的技能 chip 行：只在已选时出现，空态入口在工具栏的 `+` 面板里。 */
export default function SkillChips({
  catalog,
  selected,
  budget,
  togglingId,
  disabled,
  onToggle,
}: SkillChipsProps) {
  useLocale();
  if (selected.length === 0) return null;
  const truncatedIds = new Set(budget?.truncated_skill_ids ?? []);
  /** 逐技能明细按 skill_id 索引；旧响应没有这段时集合为空，chip 走通用说明。 */
  const loadDetails = new Map((budget?.per_skill ?? []).map((item) => [item.skill_id, item]));

  return (
    <div className="assistant-skill-chips" aria-label={t("conversationSkills.row.aria")}>
      {selected.map((item) => {
        const truncated = truncatedIds.has(item.id);
        const chip = (
          <Tag
            key={item.id}
            className={`assistant-skill-chip${truncated ? " is-truncated" : ""}`}
            icon={<ExperimentOutlined />}
          >
            <span className="assistant-skill-chip-text">{item.name}</span>
            <Button
              type="text"
              size="small"
              className="assistant-skill-chip-close"
              aria-label={t("conversationSkills.chip.disable", { name: item.name })}
              icon={<CloseOutlined />}
              disabled={disabled || togglingId === item.id}
              onClick={() =>
                onToggle(findSkill(catalog, item.id, item.name, item.description), false)
              }
            />
          </Tag>
        );
        return truncated ? (
          <Tooltip key={item.id} title={truncationHint(loadDetails.get(item.id))}>
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
    </div>
  );
}
