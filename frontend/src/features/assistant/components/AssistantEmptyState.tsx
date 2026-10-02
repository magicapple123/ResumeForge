/** 新会话的引导提示和常用问题。 */

import { Button, Empty, Typography } from "antd";
import promoPlane from "../../../assets/toutou/promo-plane.png";
import { STARTER_PROMPTS, type StarterPrompt } from "../assistantTypes";
import { greetingForHour } from "../greetingText";

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
              <Typography.Text type="warning">{greeting.care}</Typography.Text>
            ) : null}
            <Typography.Text type="secondary">
              {floating
                ? "我可以帮你解决简历通使用问题、分析简历和岗位，并在你明确要求时操作允许的数据。"
                : "能帮你打磨简历、对照岗位查缺补漏、解答求职问题。可先关联岗位或简历，再按需开启资料和联网搜索。"}
            </Typography.Text>
          </div>
        }
      >
        <div className="assistant-starter-prompts" aria-label="常用求职提问">
          {STARTER_PROMPTS.map((prompt) => (
            <Button
              key={prompt.label}
              size="small"
              className="assistant-starter-prompt"
              onClick={() => onChoosePrompt(prompt)}
            >
              {prompt.label}
            </Button>
          ))}
        </div>
        {showSkillDiscovery && (
          <div className="assistant-skills-discovery">
            <Typography.Text type="secondary">
              助手还能按你导入的<strong>技能</strong>作答——技能是一份提示词（可附带知识文件），
              用来固定回答风格或流程。
            </Typography.Text>
            <Button type="link" size="small" onClick={onManageSkills}>
              到技能工作台添加技能
            </Button>
          </div>
        )}
      </Empty>
    </div>
  );
}
