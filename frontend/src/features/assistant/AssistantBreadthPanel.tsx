// SPDX-License-Identifier: Apache-2.0
/**
 * 助手拓宽面板（#18A/#18B/#18C）的挂载点：今日简报卡 + 视角切换器 + 助手任务条。
 *
 * 为什么合成一个入口：AssistantPage 已接近 500 行硬闸门（481 行），本批只允许给它
 * 加"一个 import + 一段 JSX"；三块内容的取数/交互各自封装在子组件里。
 * 浮窗（compact）不显示：浮窗只服务"边看边问"，塞不下一屏简报。
 */
import AssistantDigestCard from "./digest/AssistantDigestCard";
import PersonaSwitcher from "./personas/PersonaSwitcher";
import AssistantTaskStrip from "./tasks/AssistantTaskStrip";

interface Props {
  /** 当前会话 id；草稿态为 null（视角要挂到会话上，任务条与简报与草稿无关）。 */
  conversationId: number | null;
  /** 只有"还没有消息"的空白页才显示今日简报（有对话时消息优先）。 */
  showDigest: boolean;
  compact: boolean;
  /** 视角切换会增删对话技能，通知页面刷新技能芯片。 */
  onSkillsChanged: () => void;
}

export default function AssistantBreadthPanel({
  conversationId,
  showDigest,
  compact,
  onSkillsChanged,
}: Props) {
  if (compact) return null;
  return (
    <div className="assistant-breadth" style={{ display: "grid", gap: 10, padding: "0 16px 8px" }}>
      {showDigest ? <AssistantDigestCard /> : null}
      <AssistantTaskStrip />
      {conversationId !== null ? (
        <PersonaSwitcher conversationId={conversationId} onChanged={onSkillsChanged} />
      ) : null}
    </div>
  );
}
