// SPDX-License-Identifier: Apache-2.0
/**
 * 助手拓宽面板（#18A/#18B）的挂载点：今日简报卡 + 助手任务条。
 *
 * 为什么合成一个入口：AssistantPage 已接近 500 行硬闸门，本批只允许给它
 * 加"一个 import + 一段 JSX"；两块内容的取数/交互各自封装在子组件里。
 * 浮窗（compact）不显示：浮窗只服务"边看边问"，塞不下一屏简报。
 *
 * T26 之后**不再包含视角切换器**：视角搬到了页头（`AssistantWorkspaceHeader`）。
 * 连带效果是 `.assistant-breadth:has(.assistant-persona)` 那条"有视角行时不许压缩"
 * 的规则也一起删了——面板重新回到"可被压缩、压不下时自己滚"的单一行为。
 */
import AssistantDigestCard from "./digest/AssistantDigestCard";
import AssistantTaskStrip from "./tasks/AssistantTaskStrip";

interface Props {
  /** 只有"还没有消息"的空白页才显示今日简报（有对话时消息优先）。 */
  showDigest: boolean;
  compact: boolean;
}

export default function AssistantBreadthPanel({ showDigest, compact }: Props) {
  if (compact) return null;
  return (
    <div className="assistant-breadth" style={{ display: "grid", gap: 10, padding: "0 16px 8px" }}>
      {showDigest ? <AssistantDigestCard /> : null}
      <AssistantTaskStrip />
    </div>
  );
}
