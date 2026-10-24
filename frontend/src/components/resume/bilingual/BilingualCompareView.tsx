// SPDX-License-Identifier: Apache-2.0
/**
 * 双语**字段对照**视图（W16 / D07）：同一字段左右并排，标出差异、事实锁与可采纳入口。
 *
 * 行数据由 `features/resume-bilingual/fieldPairs` 生成（组件不读 content、不拼路径）：
 * 这样"哪些字段要对照"只有一份定义，测试也能在纯函数层覆盖。
 *
 * 事实锁字段（姓名/机构/时间/数字）**不显示采纳按钮**，只显示标记与说明——真正的拒写
 * 在服务端，这里的作用是让用户**事先**看懂为什么这条不能点。
 */
import { LockOutlined } from "@ant-design/icons";
import { Button, Tag, Tooltip, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import { bt } from "../../../features/resume-bilingual/i18n";
import { changedPairs } from "../../../features/resume-bilingual/fieldPairs";
import type { BilingualGroup, BilingualPair } from "../../../features/resume-bilingual/types";

interface Props {
  pairs: BilingualPair[];
  /** 采纳某一行（宿主负责写库；组件不判断"能不能写"，只看 blocked 标记）。 */
  onAdopt?: (path: string) => void;
  primaryLabel?: string;
  secondaryLabel?: string;
}

const GROUP_LABEL_KEYS: Record<BilingualGroup, string> = {
  header: "bilingual.compare.group.header",
  summary: "bilingual.compare.group.summary",
  education: "bilingual.compare.group.education",
  experience: "bilingual.compare.group.experience",
  projects: "bilingual.compare.group.projects",
  skills: "bilingual.compare.group.skills",
  awards: "bilingual.compare.group.awards",
  campus: "bilingual.compare.group.campus",
};

const CELL_STYLE = {
  minWidth: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 13,
} as const;

export default function BilingualCompareView({
  pairs,
  onAdopt,
  primaryLabel,
  secondaryLabel,
}: Props) {
  const visible = changedPairs(pairs);
  if (visible.length === 0) {
    return <EmptyState inline description={bt("bilingual.compare.nothing")} />;
  }

  // 分组标题只在组内第一行出现：按下标与上一行比较，渲染期不写任何外部变量。
  const rows = visible.map((pair, index) => ({
    pair,
    showGroup: index === 0 || visible[index - 1].group !== pair.group,
  }));
  return (
    <div data-bilingual-compare="1">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 140px) 1fr 1fr auto",
          gap: "6px 12px",
          alignItems: "start",
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bt("bilingual.compare.title")}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {primaryLabel ?? bt("bilingual.compare.columnPrimary")}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {secondaryLabel ?? bt("bilingual.compare.columnSecondary")}
        </Typography.Text>
        <span />
        {rows.map(({ pair, showGroup }) => (
          <Row
            key={pair.id}
            pair={pair}
            showGroup={showGroup}
            onAdopt={pair.locked ? undefined : onAdopt}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  pair,
  showGroup,
  onAdopt,
}: {
  pair: BilingualPair;
  showGroup: boolean;
  onAdopt?: (path: string) => void;
}) {
  return (
    <>
      {showGroup ? (
        <Typography.Text strong style={{ gridColumn: "1 / -1", marginTop: 6 }}>
          {bt(GROUP_LABEL_KEYS[pair.group] as Parameters<typeof bt>[0])}
        </Typography.Text>
      ) : null}
      <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <Typography.Text style={{ fontSize: 12 }} ellipsis>
          {bt(pair.labelKey as Parameters<typeof bt>[0])}
        </Typography.Text>
        {pair.locked ? (
          <Tooltip title={bt("bilingual.compare.lockedHint")}>
            <Tag icon={<LockOutlined />} color="gold" style={{ marginInlineEnd: 0 }}>
              {bt("bilingual.compare.locked")}
            </Tag>
          </Tooltip>
        ) : null}
      </span>
      <div style={CELL_STYLE}>{pair.primary || "-"}</div>
      <div style={CELL_STYLE}>{pair.secondary || "-"}</div>
      <span>
        {pair.status === "changed" && onAdopt ? (
          <Button
            size="small"
            type="link"
            aria-label={bt("bilingual.compare.adoptAria", {
              index: pair.id,
            })}
            onClick={() => onAdopt(pair.path)}
          >
            {bt("bilingual.compare.adopt")}
          </Button>
        ) : null}
      </span>
    </>
  );
}
