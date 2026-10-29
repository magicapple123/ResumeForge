// SPDX-License-Identifier: Apache-2.0
/**
 * 双语**字段对照**视图（W16 / D07）：同一字段左右并排，标出差异、事实锁与可采纳入口。
 *
 * 行数据由 `features/resume-bilingual/fieldPairs` 生成（组件不读 content、不拼路径）：
 * 这样"哪些字段要对照"只有一份定义，测试也能在纯函数层覆盖。
 *
 * 事实锁字段（姓名/机构/时间/数字）**不显示采纳按钮**，只显示标记与说明——真正的拒写
 * 在服务端，这里的作用是让用户**事先**看懂为什么这条不能点。
 *
 * 版式：**窄栏堆叠、宽栏并排**。这块面板住在制作台左栏（默认 380px，可拖到 640px），
 * 三列并排时每列只剩 80 多像素，中文会被逐字折行（用户 2026-11 反馈"排版有点乱"）。
 * 所以默认是「字段名 + 操作」一行、下面中文一段、英文一段，各带一个小语种标签；
 * 只有容器够宽（≥620px）时才切回「字段名 | 中文 | 英文 | 操作」四栏。
 * 判定用容器查询（`styles/bilingual.css` 里的 `@container`），不用视口断点——
 * 面板宽度由用户拖动决定，与窗口宽度不是一回事。
 */
import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Tag, Tooltip, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { changedPairs } from "../../../features/resume-bilingual/fieldPairs";
import type { BilingualGroup, BilingualPair } from "../../../features/resume-bilingual/types";

interface Props {
  pairs: BilingualPair[];
  /** 采纳某一行（宿主负责写库；组件不判断"能不能写"，只看 blocked 标记）。 */
  onAdopt?: (path: string) => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  /**
   * 这份版本与当前简历内容**字节级相同**（还没翻过）。
   *
   * 新建语言版本的流程是「先复制正文，再翻译」：翻译没跑成时两列一字不差，
   * 用户会以为功能坏了。此时在表格上方给一条"去生成翻译候选"的提示，
   * 不改变任何行数据（对照本身是真实的）。
   */
  identical?: boolean;
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

export default function BilingualCompareView({
  pairs,
  onAdopt,
  primaryLabel,
  secondaryLabel,
  identical,
}: Props) {
  useLocale();
  const visible = changedPairs(pairs);
  if (visible.length === 0) {
    return <EmptyState inline description={bt("bilingual.compare.nothing")} />;
  }

  // 分组：同一板块的行连成一块（只保留分组标题一次），渲染期不写任何外部变量。
  const groups: { group: BilingualGroup; rows: BilingualPair[] }[] = [];
  for (const pair of visible) {
    const last = groups[groups.length - 1];
    if (last && last.group === pair.group) last.rows.push(pair);
    else groups.push({ group: pair.group, rows: [pair] });
  }

  return (
    <>
      {/* 提示条必须在 `.bilingual-compare` **外面**：那个容器的子元素直接参与网格排版，
          插进去会打乱表头/行/分组的列对齐。 */}
      {identical ? (
        <Alert
          type="info"
          showIcon
          className="bilingual-compare-notice"
          title={bt("bilingual.compare.identical")}
        />
      ) : null}
      <div className="bilingual-compare" data-bilingual-compare="1">
        <div className="bilingual-compare__head">
          <span className="bilingual-compare__head-cell">{bt("bilingual.compare.title")}</span>
          <span className="bilingual-compare__head-cell">
            {primaryLabel ?? bt("bilingual.compare.columnPrimary")}
          </span>
          <span className="bilingual-compare__head-cell">
            {secondaryLabel ?? bt("bilingual.compare.columnSecondary")}
          </span>
          <span className="bilingual-compare__head-cell" />
        </div>
        {groups.map((group) => (
          <section key={group.group} className="bilingual-compare__group">
            <Typography.Text strong className="bilingual-compare__group-title">
              {bt(GROUP_LABEL_KEYS[group.group] as Parameters<typeof bt>[0])}
            </Typography.Text>
            {group.rows.map((pair) => (
              <Row
                key={pair.id}
                pair={pair}
                onAdopt={pair.locked ? undefined : onAdopt}
                primaryLabel={primaryLabel ?? bt("bilingual.compare.columnPrimary")}
                secondaryLabel={secondaryLabel ?? bt("bilingual.compare.columnSecondary")}
              />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function Row({
  pair,
  onAdopt,
  primaryLabel,
  secondaryLabel,
}: {
  pair: BilingualPair;
  onAdopt?: (path: string) => void;
  primaryLabel: string;
  secondaryLabel: string;
}) {
  useLocale();
  return (
    <div className="bilingual-compare__row" data-pair-path={pair.path}>
      <span className="bilingual-compare__field">
        <Typography.Text className="bilingual-compare__field-label" ellipsis>
          {bt(pair.labelKey as Parameters<typeof bt>[0])}
        </Typography.Text>
        {pair.locked ? (
          <Tooltip title={bt("bilingual.compare.lockedHint")}>
            <Tag icon={<LockOutlined />} color="gold" className="bilingual-compare__lock">
              {bt("bilingual.compare.locked")}
            </Tag>
          </Tooltip>
        ) : null}
      </span>
      {/* 每个语种一个 cell：宽栏并排时是小语种标签隐藏、值占一列；窄栏堆叠时标签
          变成值的标题（否则两段中文/英文只靠颜色区分，读起来要来回猜哪段是哪种语言）。 */}
      <div className="bilingual-compare__cell bilingual-compare__cell--primary">
        <span className="bilingual-compare__lang">{primaryLabel}</span>
        <div className="bilingual-compare__value bilingual-compare__value--primary">
          {pair.primary || "-"}
        </div>
      </div>
      <div className="bilingual-compare__cell bilingual-compare__cell--secondary">
        <span className="bilingual-compare__lang">{secondaryLabel}</span>
        <div className="bilingual-compare__value bilingual-compare__value--secondary">
          {pair.secondary || "-"}
        </div>
      </div>
      <span className="bilingual-compare__action">
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
    </div>
  );
}
