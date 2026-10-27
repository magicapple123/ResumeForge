// SPDX-License-Identifier: Apache-2.0
/** 版本对比视图：三态高亮（added / removed / unchanged）。
 *
 * 只渲染后端 ``services/resume_diff.py`` 下发的三态结构，不重算 diff——共享知识第 11 条。
 */
import { Tag, Typography } from "antd";
import type { CSSProperties } from "react";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import type { DiffLine, DiffLineType, DiffToken, ResumeDiff } from "../types/resumeWriting";

/**
 * 三态配色全部走语义 token（`--rf-diff-*`）：浅色的取值与原来写死的
 * `#f6ffed/#d9f7be/#fff1f0/#ffccc7/#135200/#a8071a` 逐项等值（视觉不变），
 * 深色另给一套暗底亮字（见 `theme/dark-tokens.css`）。
 */
const LINE_STYLE: Record<DiffLineType, CSSProperties> = {
  added: { background: "var(--rf-diff-added-bg)", color: "var(--rf-diff-added-text)" },
  removed: {
    background: "var(--rf-diff-removed-bg)",
    color: "var(--rf-diff-removed-text)",
    textDecoration: "line-through",
  },
  unchanged: { background: "transparent" },
};

/** 词级高亮用 --rf-diff-*-border 那一档：它是同一色系里更实的一档填充。 */
const TOKEN_STYLE: Record<DiffLineType, CSSProperties> = {
  added: { background: "var(--rf-diff-added-border)", color: "var(--rf-diff-added-text)" },
  removed: {
    background: "var(--rf-diff-removed-border)",
    color: "var(--rf-diff-removed-text)",
    textDecoration: "line-through",
  },
  unchanged: {},
};

/**
 * 词级 DiffToken 序列的渲染（RF-13 抽出复用）：ResumeChangeReviewModal 的逐条
 * diff 与本视图用同一套三态配色——同一语义两套颜色必然让人困惑。
 */
export function DiffTokenText({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={TOKEN_STYLE[token.type]}>
          {token.text}{" "}
        </span>
      ))}
    </>
  );
}

const PREFIX: Record<DiffLineType, string> = {
  added: "+ ",
  removed: "− ",
  unchanged: "  ",
};

export default function ResumeDiffView({ diff }: { diff: ResumeDiff }) {
  useLocale();
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text>{t("componentsMisc.resumeDiff.compare")}</Typography.Text>
        <Typography.Text strong>{diff.base_title}</Typography.Text>
        <Typography.Text type="secondary"> → </Typography.Text>
        <Typography.Text strong>{diff.against_title}</Typography.Text>
        <span style={{ marginLeft: 12 }}>
          <Tag color="green">
            {t("componentsMisc.resumeDiff.stat.added", { added: diff.stats.added })}
          </Tag>
          <Tag color="red">
            {t("componentsMisc.resumeDiff.stat.removed", { removed: diff.stats.removed })}
          </Tag>
          <Tag>
            {t("componentsMisc.resumeDiff.stat.unchanged", { unchanged: diff.stats.unchanged })}
          </Tag>
        </span>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.7 }}>
        {diff.lines.map((line, index) => (
          <DiffLineRow key={index} line={line} />
        ))}
      </div>
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.tokens.length === 0) {
    return (
      <div data-line-type={line.type} style={LINE_STYLE[line.type]}>
        {PREFIX[line.type]}
        {line.text || " "}
      </div>
    );
  }
  return (
    <div data-line-type={line.type} style={LINE_STYLE[line.type]}>
      {PREFIX[line.type]}
      {line.tokens.map((token, index) => (
        <span key={index} style={TOKEN_STYLE[token.type]}>
          {token.text}{" "}
        </span>
      ))}
    </div>
  );
}
