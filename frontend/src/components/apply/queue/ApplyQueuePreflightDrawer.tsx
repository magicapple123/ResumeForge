// SPDX-License-Identifier: Apache-2.0
/**
 * 投递前体检抽屉（#14A）：按严重度分组，逐条给「为什么」与「怎么修」。
 *
 * 分工（详册 #14A 的"为什么不是再做一个准入"）：`admission` 回答「岗位要求我够不够」，
 * 体检回答「这一条现在投出去会不会白投」——简历缺失、招呼语重复、来源不支持这三类
 * `admission` 都不管。所以这里**只展示后端给的结论**，不在前端重判一次准入。
 *
 * 「一键修」按规则码分派三种动作：移出队列 / 去改这一条 / 去岗位广场分析。
 * blocking 不给"仍要投"的按钮——确认在「开始投递」那一侧（弹层），这里只负责修。
 */
import { Link } from "react-router-dom";
import { Button, Divider, Drawer, Space, Tag, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import LoadingBlock from "../../common/LoadingBlock";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type {
  ApplyPreflightCode,
  ApplyPreflightIssue,
  ApplyPreflightResult,
  ApplyPreflightSeverity,
  ApplyQueueItem,
} from "../../../types";

/** 规则码 → 展示名（协议值在左，展示名在语言包里）。 */
const CODE_LABEL_KEYS: Record<ApplyPreflightCode, MessageKey> = {
  source_unsupported: "applyQueue.preflight.code.source_unsupported",
  resume_missing: "applyQueue.preflight.code.resume_missing",
  match_missing: "applyQueue.preflight.code.match_missing",
  match_weak: "applyQueue.preflight.code.match_weak",
  greeting_weak: "applyQueue.preflight.code.greeting_weak",
  // #15A 僵尸岗提示：结论是「可能挂着不招」，不是"你哪里没准备好"。
  ghost_job: "applyQueue.preflight.code.ghost_job",
};

/**
 * 「一键修」的落点。
 *
 * `ignore` 不是"修"：僵尸岗是**提示**，投不投由用户决定，忽略入口在队列行的徽标上
 * （Popover 里的「忽略此岗位」）。体检里给一个"忽略"按钮等于替用户做决定，所以这一档
 * **不渲染按钮**——`fix` 那行后端文案已经把两个选项都说清楚了。
 */
type FixAction = "remove" | "edit" | "jobs" | "ignore";

/** 规则码 → 一键修的动作（唯一实现，抽屉与测试都从这里读）。 */
export function fixActionOf(code: ApplyPreflightCode): FixAction {
  if (code === "source_unsupported") return "remove";
  if (code === "match_missing") return "jobs";
  if (code === "ghost_job") return "ignore";
  return "edit";
}

interface FlatIssue {
  queueId: number;
  item: ApplyQueueItem | undefined;
  issue: ApplyPreflightIssue;
}

function flatten(result: ApplyPreflightResult, items: readonly ApplyQueueItem[]): FlatIssue[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return result.items.flatMap((entry) =>
    entry.issues.map((issue) => ({
      queueId: entry.queue_id,
      item: byId.get(entry.queue_id),
      issue,
    })),
  );
}

function IssueGroup({
  severity,
  rows,
  onFixRemove,
  onFixEdit,
}: {
  severity: ApplyPreflightSeverity;
  rows: FlatIssue[];
  onFixRemove: (queueId: number) => void;
  onFixEdit: (item: ApplyQueueItem) => void;
}) {
  if (rows.length === 0) return null;
  const blocking = severity === "blocking";
  return (
    <section className="apply-queue-preflight-group">
      <Tag color={blocking ? "red" : "gold"}>
        {t(blocking ? "applyQueue.preflight.blocking" : "applyQueue.preflight.warning", {
          count: rows.length,
        })}
      </Tag>
      {rows.map((row) => {
        const action = fixActionOf(row.issue.code);
        const label =
          action === "remove"
            ? t("applyQueue.preflight.fixRemove")
            : action === "jobs"
              ? t("applyQueue.preflight.fixJobs")
              : t("applyQueue.preflight.fixEdit");
        return (
          <div className="apply-queue-preflight-row" key={`${row.queueId}-${row.issue.code}`}>
            <Space orientation="vertical" size={2} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <Typography.Text strong>
                  {row.item?.job_title || t("applyQueue.detail.deletedJob")}
                </Typography.Text>
                <Tag color={blocking ? "red" : "gold"}>{t(CODE_LABEL_KEYS[row.issue.code])}</Tag>
              </Space>
              <Typography.Text type="secondary">{row.issue.message}</Typography.Text>
              <Typography.Text type="secondary">
                {t("applyQueue.preflight.fixLabel", { fix: row.issue.fix })}
              </Typography.Text>
            </Space>
            {/* `ignore`（僵尸岗）= 只提示、不给一键动作：投不投是用户的决定，
                "忽略这条提示"在队列行的徽标里（Popup → 「忽略此岗位」）。 */}
            {action === "ignore" ? null : action === "jobs" ? (
              <Link to="/jobs">
                <Button size="small">{label}</Button>
              </Link>
            ) : (
              <Button
                size="small"
                danger={action === "remove"}
                disabled={action === "edit" && !row.item}
                onClick={() =>
                  action === "remove" ? onFixRemove(row.queueId) : row.item && onFixEdit(row.item)
                }
              >
                {label}
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function ApplyQueuePreflightDrawer({
  open,
  loading,
  result,
  items,
  onClose,
  onFixRemove,
  onFixEdit,
}: {
  open: boolean;
  loading: boolean;
  /** null = 还没跑过（抽屉里只显示加载/空态）。 */
  result: ApplyPreflightResult | null;
  /** 全量队列条目：用来把 `queue_id` 还原成岗位名与编辑目标。 */
  items: readonly ApplyQueueItem[];
  onClose: () => void;
  onFixRemove: (queueId: number) => void;
  onFixEdit: (item: ApplyQueueItem) => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后抽屉停在旧文案。
  useLocale();
  const rows = result ? flatten(result, items) : [];
  const blocking = rows.filter((row) => row.issue.severity === "blocking");
  const warnings = rows.filter((row) => row.issue.severity === "warning");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("applyQueue.preflight.title")}
      size="default"
      footer={null}
    >
      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState inline description={t("applyQueue.preflight.empty")} />
      ) : (
        <>
          <Typography.Paragraph type="secondary">
            {t("applyQueue.preflight.summary", {
              blocking: result?.summary.blocking ?? blocking.length,
              warnings: result?.summary.warnings ?? warnings.length,
            })}
          </Typography.Paragraph>
          <IssueGroup
            severity="blocking"
            rows={blocking}
            onFixRemove={onFixRemove}
            onFixEdit={onFixEdit}
          />
          {blocking.length > 0 && warnings.length > 0 && <Divider plain />}
          <IssueGroup
            severity="warning"
            rows={warnings}
            onFixRemove={onFixRemove}
            onFixEdit={onFixEdit}
          />
        </>
      )}
    </Drawer>
  );
}
