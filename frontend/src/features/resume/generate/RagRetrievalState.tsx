// SPDX-License-Identifier: Apache-2.0
/**
 * #30 语义检索回执的**唯一展示出口**：进度行徽标（progress）与结果卡审计行（audit）。
 *
 * 为什么不是"一个开关状态"：用户要回答的是"这一次到底用没用上语义检索"。把设置页的
 * 配置状态渲染成绿色的"已开启"就是虚假接地感——所以五态严格区分：off（灰）/
 * empty（黄）/ miss（黄）/ hit（绿）/ fallback（橙，带耗时）。
 *
 * 为什么 hit_count 与 impacts 一起出现：计数按条目、列表也按条目，两者同源（后端
 * 同一份 rag_state_payload），列表长度必须等于 hit_count，界面不另算一套。
 *
 * 纯展示：跳转与"去开启"都经 props 下发，组件不持有 Router / api。
 */
import { Button, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { RagRetrieval, RagState } from "../../../types";

/** antd Tag 预设色：off 灰 / empty+miss 黄 / hit 绿 / fallback 橙（与详册五态表一致）。 */
const STATE_COLOR: Record<RagState, string> = {
  off: "default",
  empty: "gold",
  miss: "gold",
  hit: "green",
  fallback: "orange",
};

function stateText(rag: RagRetrieval): string {
  switch (rag.state) {
    case "hit":
      return t("generateStages.rag.state.hit", { count: rag.hit_count });
    case "empty":
      return t("generateStages.rag.state.empty");
    case "miss":
      return t("generateStages.rag.state.miss");
    case "fallback":
      return t("generateStages.rag.state.fallback", { ms: rag.elapsed_ms ?? 0 });
    default:
      return t("generateStages.rag.state.off");
  }
}

interface Props {
  rag: RagRetrieval | null | undefined;
  /** progress = 生成中的徽标行；audit = 结果卡底部的可展开审计行。 */
  variant: "progress" | "audit";
  /** "去开启"：跳设置页的语义检索设置。 */
  onEnable?: () => void;
  /** 明细里单条经历的跳转（去资料页查看）。 */
  onOpenProfile?: () => void;
}

export default function RagRetrievalState({ rag, variant, onEnable, onOpenProfile }: Props) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  if (!rag) return null;
  const impacts = rag.impacts ?? [];
  const enable =
    rag.state === "off" && onEnable ? (
      <Button type="link" size="small" style={{ padding: 0 }} onClick={onEnable}>
        {t("generateStages.rag.enable")}
      </Button>
    ) : null;

  if (variant === "progress") {
    return (
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary">{t("generateStages.rag.progress.label")}</Typography.Text>
        <Tag color={STATE_COLOR[rag.state]} style={{ marginInlineEnd: 0 }}>
          {stateText(rag)}
        </Tag>
        {enable}
      </Space>
    );
  }

  const label =
    rag.state === "hit"
      ? t("generateStages.rag.audit.hit", { count: rag.hit_count, impacts: impacts.length })
      : stateText(rag);
  return (
    <div data-testid="rag-audit" style={{ marginTop: 12 }}>
      <Space size={8} wrap>
        <Tag color={STATE_COLOR[rag.state]} style={{ marginInlineEnd: 0 }}>
          {label}
        </Tag>
        {rag.state === "hit" && impacts.length > 0 ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("generateStages.rag.audit.collapse")
              : t("generateStages.rag.audit.expand")}
          </Button>
        ) : null}
        {enable}
      </Space>
      {expanded && impacts.length > 0 ? (
        <ul data-testid="rag-audit-impacts" style={{ margin: "8px 0 0", paddingInlineStart: 20 }}>
          {impacts.map((impact, index) => (
            <li key={`${impact.entry_id || "entry"}-${index}`}>
              <Space size={8} wrap>
                <Typography.Text>{impact.title || impact.section}</Typography.Text>
                <Typography.Text type="secondary">{impact.section}</Typography.Text>
                <Typography.Text type="success">+{impact.delta}</Typography.Text>
                {onOpenProfile ? (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={onOpenProfile}>
                    {t("generateStages.rag.audit.jump")}
                  </Button>
                ) : null}
              </Space>
            </li>
          ))}
        </ul>
      ) : null}
      {expanded && rag.state === "hit" ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          {t("generateStages.rag.audit.exportNote")}
        </Typography.Text>
      ) : null}
    </div>
  );
}
