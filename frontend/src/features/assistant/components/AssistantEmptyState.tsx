// SPDX-License-Identifier: Apache-2.0
/** 新会话的引导提示和常用问题。 */

import { Button, Empty, Typography } from "antd";
import promoPlane from "../../../assets/toutou/promo-plane.webp";
import { STARTER_PROMPTS, type StarterPrompt } from "../assistantTypes";
import { greetingForHour } from "../greetingText";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  variant?: "page" | "floating";
  onChoosePrompt: (prompt: StarterPrompt) => void;
  /** 已启用的技能数量，用于判断要不要提示"还有技能这个功能"。 */
  enabledSkillCount: number;
  /** 技能列表是否已取回；加载中就提示"还没有技能"会先闪一下。 */
  skillsLoaded: boolean;
  onManageSkills: () => void;
}

export default function AssistantEmptyState({
  variant = "page",
  onChoosePrompt,
  enabledSkillCount,
  skillsLoaded,
  onManageSkills,
}: Props) {
  useLocale();
  // 有技能在生效时页头已经写着，这里只在"一个都没启用"时负责让用户知道有这回事。
  const floating = variant === "floating";
  // 时间感知：深夜/凌晨补一句休息提醒（本地单用户，浏览器时间即用户时间）。
  const greeting = greetingForHour(new Date().getHours());
  const showSkillDiscovery = !floating && skillsLoaded && enabledSkillCount === 0;
  return (
    <div className="assistant-empty-state">
      <Empty
        // 投投宣传图替代 antd 灰托盘图：主界面与悬浮卡都用同一张（悬浮卡用 CSS 缩小）。
        image={<img src={promoPlane} alt="" className="assistant-empty-state-brand" />}
        description={
          <div className="assistant-empty-state-copy">
            <Typography.Text strong>{greeting.headline}</Typography.Text>
            {greeting.care ? (
              // 关怀语用站内 warning 文字 token（accessibility.css 里着色），而不是 antd 的
              // type="warning"——后者的 #faad14 在白/浅底上只有 ~1.9:1，过不了 axe 的 AA。
              <Typography.Text className="assistant-empty-state-care">
                {greeting.care}
              </Typography.Text>
            ) : null}
            <Typography.Text type="secondary">
              {floating
                ? t("assistantUi.empty.floatingDescription")
                : t("assistantUi.empty.pageDescription")}
            </Typography.Text>
          </div>
        }
      >
        <div
          className="assistant-starter-prompts"
          aria-label={t("assistantUi.empty.starterPromptsAria")}
        >
          {STARTER_PROMPTS.map((prompt) => (
            <Button
              key={prompt.labelKey}
              size="small"
              className="assistant-starter-prompt"
              onClick={() => onChoosePrompt(prompt)}
            >
              {t(prompt.labelKey)}
            </Button>
          ))}
        </div>
        {showSkillDiscovery && (
          <div className="assistant-skills-discovery">
            <Typography.Text type="secondary">
              {t("assistantUi.empty.skillsDiscoveryBefore")}
              <strong>{t("assistantUi.empty.skillsDiscoveryTerm")}</strong>
              {t("assistantUi.empty.skillsDiscoveryAfter")}
            </Typography.Text>
            <Button type="link" size="small" onClick={onManageSkills}>
              {t("assistantUi.empty.manageSkills")}
            </Button>
          </div>
        )}
      </Empty>
    </div>
  );
}
