// SPDX-License-Identifier: Apache-2.0
/**
 * #15A 僵尸岗雷达的队列行徽标：「僵尸 82」+ 证据 + 「忽略此岗位」。
 *
 * 三条刻意的行为：
 * - **没有分数就不渲染**（`ghost_score == null`）：冷启动只有 1 条 sighting，后端不给分，
 *   前端也绝不把"没数据"画成 0 分——那会被读成"这岗位很健康"；
 * - **三档颜色是提醒强度，不是结论**：<40 中性、40–69 橙、≥70 红；红色只说"这条值得先看一眼"，
 *   投不投仍然由用户决定（准入结论在另一列，这里不改它）；
 * - **「忽略」只收起这个徽标，且只改本地这一行**：请求成功后本行立刻不渲染，不整表刷新
 *   （刷整表会把用户正在看的排序与滚动位置一起打回去）；失败则弹一句 error 并**保留**徽标。
 *
 * 证据逐条原样展示后端给的人话；前端不改写措辞、不重算阈值。
 */
import { App, Button, Popconfirm, Popover, Space, Tag, Typography } from "antd";
import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { setGhostIgnored } from "../../../api/applyInsights";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

/** 僵尸分的三档提醒强度（颜色档位名，与 CSS 的 `[data-band]` 一一对应）。 */
type GhostBand = "low" | "mid" | "high";

/**
 * 分数 → 档位。阈值只有这一处实现：<40 / 40–69 / ≥70（详册 #15A「>70 降级为 warning」）。
 *
 * 不导出：档位是**这个徽标的视觉决策**，外面没有第二个消费者；要断言就用 DOM 上的
 * `data-band`（测试也这么写），别让"档位表"变成第二次实现。
 */
function ghostBandOf(score: number): GhostBand {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

/** 档位 → antd Tag 的颜色名（灰 / 橙 / 红）。 */
const BAND_COLOR: Record<GhostBand, string> = {
  low: "default",
  mid: "orange",
  high: "red",
};

interface Props {
  /** 队列条目 id（不是岗位 id）——忽略时按它发 PUT。 */
  queueId: number;
  /** 后端给的 0–100 分；`null` / `undefined` = 复采历史不足，不渲染。 */
  score: number | null | undefined;
  /** 四项证据（后端的人话），逐条展示。 */
  evidence?: string[];
  /** 之前已经忽略过：直接不渲染。 */
  ignored?: boolean;
}

export default function GhostBadge({ queueId, score, evidence, ignored = false }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { message } = App.useApp();
  /** 本地忽略态：成功后只收起这一行的徽标，不惊动整表。 */
  const [hiddenLocally, setHiddenLocally] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Popover 的受控开合：键盘也要能打开（span 上的 role=button 不会自己响应 Enter）。 */
  const [open, setOpen] = useState(false);

  if (ignored || hiddenLocally || score === null || score === undefined) return null;

  const band = ghostBandOf(score);
  const lines = evidence ?? [];

  /**
   * 键盘等价：Enter / 空格切换证据浮层。
   * 只拦这两个键——行本身还要响应 Shift+F10（右键菜单），不能把整行的键盘事件吃掉。
   */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen((current) => !current);
  };

  const ignore = async () => {
    setSaving(true);
    try {
      await setGhostIgnored(queueId, { ignored: true });
      setHiddenLocally(true);
      message.success(t("applyQueue.insights.ghost.ignored"));
    } catch (err) {
      // 失败就保持原样：徽标还在，用户能再点一次；队列与投递完全不受影响。
      message.error(
        err instanceof Error ? err.message : t("applyQueue.insights.ghost.ignoreFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <Space orientation="vertical" size={6}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("applyQueue.insights.ghost.hint")}
      </Typography.Text>
      {lines.length > 0 ? (
        <ul className="apply-ghost-evidence">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("applyQueue.insights.ghost.emptyEvidence")}
        </Typography.Text>
      )}
      {/* 二次确认用就地 Popconfirm（高频、可撤销的"收起提示"不做弹层）：
          只是"不再提示"，不是删数据，所以按钮不标红。 */}
      <Popconfirm
        title={t("applyQueue.insights.ghost.ignoreTitle")}
        description={t("applyQueue.insights.ghost.ignoreBody")}
        okText={t("applyQueue.insights.ghost.ignoreOk")}
        cancelText={t("common.action.cancel")}
        onConfirm={() => void ignore()}
      >
        <Button size="small" type="link" loading={saving}>
          {t("applyQueue.insights.ghost.ignore")}
        </Button>
      </Popconfirm>
    </Space>
  );

  return (
    <Popover
      content={content}
      title={t("applyQueue.insights.ghost.popoverTitle")}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
    >
      <Tag
        className="apply-ghost-badge"
        data-band={band}
        color={BAND_COLOR[band]}
        // 徽标本身是"看证据"的入口：给它按钮语义，键盘（Enter / 空格）也能打开。
        role="button"
        tabIndex={0}
        aria-label={t("applyQueue.insights.ghost.badge", { score })}
        aria-expanded={open}
        onKeyDown={handleKeyDown}
      >
        {t("applyQueue.insights.ghost.badge", { score })}
      </Tag>
    </Popover>
  );
}
