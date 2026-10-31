// SPDX-License-Identifier: Apache-2.0
/**
 * 双语**字段对照**视图（W16 / D07，v2 文档模型）：同一 item 左右并排，标出差异、事实锁
 * 与可采纳入口。
 *
 * 行数据由 `features/resume-bilingual/fieldPairs` 生成（组件不读文档结构、不拼路径）：
 * "哪些 item 要对照"只有一份定义，纯函数层可单测。
 *
 * v2 口径：
 * - 只有 `FieldItem / TextItem` 可逐项采纳；列表/作者/自建字段是**只读对照**，
 *   界面用标签说明（详见 fieldPairs 文件头的取舍）；
 * - 事实锁字段（姓名/机构/时间/数字）不显示采纳按钮，只显示标记与说明——真正拒写在服务端。
 *
 * 版式：**窄栏堆叠、宽栏并排**（容器查询，见 `styles/bilingual.css`），不用视口断点——
 * 面板宽度由用户拖左栏决定，与窗口宽度不是一回事。
 */
import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Tag, Tooltip, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { changedPairs } from "../../../features/resume-bilingual/fieldPairs";
import type { BilingualPair } from "../../../features/resume-bilingual/types";

interface Props {
  pairs: BilingualPair[];
  /** 采纳某一行（宿主负责写库；组件不判断"能不能写"，只看 adoptable/locked 标记）。 */
  onAdopt?: (path: string) => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  /**
   * 这份版本与当前简历内容**字节级相同**（还没翻过）。
   *
   * 新建语言版本的流程是「先复制正文，再翻译」：翻译没跑成时两列一字不差，
   * 用户会以为功能坏了。此时在表格上方给一条"去生成翻译候选"的提示，不改变任何行数据。
   */
  identical?: boolean;
}

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
  const groups: { sectionKey: string; groupLabel: string; rows: BilingualPair[] }[] = [];
  for (const pair of visible) {
    const last = groups[groups.length - 1];
    if (last && last.sectionKey === pair.sectionKey) last.rows.push(pair);
    else
      groups.push({
        sectionKey: pair.sectionKey,
        groupLabel: pair.groupLabel,
        rows: [pair],
      });
  }

  const comparePrimary = primaryLabel ?? bt("bilingual.compare.columnPrimary");
  const compareSecondary = secondaryLabel ?? bt("bilingual.compare.columnSecondary");

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
          <span className="bilingual-compare__head-cell">{comparePrimary}</span>
          <span className="bilingual-compare__head-cell">{compareSecondary}</span>
          <span className="bilingual-compare__head-cell" />
        </div>
        {groups.map((group) => (
          <section key={group.sectionKey} className="bilingual-compare__group">
            <Typography.Text strong className="bilingual-compare__group-title">
              {group.groupLabel}
            </Typography.Text>
            {group.rows.map((pair) => (
              <Row
                key={pair.id}
                pair={pair}
                onAdopt={
                  pair.adoptable && !pair.locked && pair.status === "changed" ? onAdopt : undefined
                }
                primaryLabel={comparePrimary}
                secondaryLabel={compareSecondary}
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
          {pair.label}
        </Typography.Text>
        {pair.locked ? (
          <Tooltip title={bt("bilingual.compare.lockedHint")}>
            <Tag icon={<LockOutlined />} color="gold" className="bilingual-compare__lock">
              {bt("bilingual.compare.locked")}
            </Tag>
          </Tooltip>
        ) : !pair.adoptable ? (
          <Tooltip title={bt("bilingual.compare.readOnlyHint")}>
            <Tag className="bilingual-compare__lock">{bt("bilingual.compare.readOnlyTag")}</Tag>
          </Tooltip>
        ) : null}
      </span>
      <PairCell tone="primary" label={primaryLabel} text={pair.primary} />
      <PairCell tone="secondary" label={secondaryLabel} text={pair.secondary} />
      <span className="bilingual-compare__action">
        {onAdopt ? (
          <Button
            size="small"
            aria-label={bt("bilingual.compare.adoptAria", { index: pair.path })}
            onClick={() => onAdopt(pair.path)}
          >
            {bt("bilingual.compare.adopt")}
          </Button>
        ) : null}
      </span>
      <div className="bilingual-compare__status" data-pair-status={pair.status}>
        {pair.status === "changed"
          ? bt("bilingual.compare.changed")
          : pair.status === "same"
            ? bt("bilingual.compare.same")
            : bt("bilingual.compare.empty")}
      </div>
    </div>
  );
}

/**
 * 一格译文（Q24）。
 *
 * 类名与 `styles/bilingual.css` 的既定契约对齐：宽布局（容器 ≥620px，四栏并排）里
 * 表头已写明语种，行内 `.bilingual-compare__lang` 由容器查询隐藏，不再重复
 * 「当前简历 / 英文版」；窄布局（堆叠）没有表头，行内标签就是那个语种提示，必须保留。
 */
function PairCell({
  tone,
  label,
  text,
}: {
  tone: "primary" | "secondary";
  label: string;
  text: string;
}) {
  return (
    <div className={`bilingual-compare__cell bilingual-compare__cell--${tone}`}>
      <span className="bilingual-compare__lang">{label}</span>
      <span className={`bilingual-compare__value bilingual-compare__value--${tone}`}>
        {text || "—"}
      </span>
    </div>
  );
}
