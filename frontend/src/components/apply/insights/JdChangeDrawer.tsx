// SPDX-License-Identifier: Apache-2.0
/**
 * #15B「岗位描述变更」抽屉：左右两栏对比**上次采集 / 本次采集**。
 *
 * 三条不可动摇的口径：
 * 1. **被动式**：数据只在你下次采集时才会更新，所以顶部必须写明「下次采集时更新」——
 *    不写的话用户会以为点开就是"实时重新抓了一遍"，然后怀疑我们抓错了；
 * 2. **只对比后端给的两份文本**：不在前端重抓 JD、不猜"变更了几处"（契约没有这个数）；
 * 3. **失败不阻挡任何东西**：取不到就只在这个抽屉里报一句，投递记录与重投都不受影响。
 *
 * 两栏逐行对齐由 `jdChangeDiff` 负责（左=上次、右=本次，删除行红底、新增行绿底）。
 */
import { Alert, Drawer, Space, Tag, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import LoadingBlock from "../../common/LoadingBlock";
import { formatDateTime } from "../../../utils/format";
import { useApi } from "../../../hooks/useApi";
import { getJdChange } from "../../../api/applyInsights";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyJdChange } from "../../../types";
import { diffJdText, type JdDiffCell } from "./jdChangeDiff";

interface Props {
  open: boolean;
  /** 队列条目 id（不是岗位 id）；`null` = 记录上没带队列条目，取不到明细，不发请求。 */
  queueId: number | null;
  onClose: () => void;
}

/** 没有 queue id 时的占位响应：让 `useApi` 的返回值形状恒定，界面走同一条渲染路径。 */
const NO_CHANGE: ApplyJdChange = { changed: false, before: "", after: "", seen_at: null };

function DiffCell({ cell, label }: { cell: JdDiffCell | null; label: string }) {
  if (cell === null) {
    // 对侧没有对应行：留一个空槽保住行对齐，同时让读屏知道这边是空的。
    return <div className="apply-jd-diff-cell" data-diff="none" aria-label={label} />;
  }
  return (
    <div className="apply-jd-diff-cell" data-diff={cell.kind}>
      {cell.text || " "}
    </div>
  );
}

export default function JdChangeDrawer({ open, queueId, onClose }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { data, loading, error } = useApi<ApplyJdChange>(
    () => (queueId === null ? Promise.resolve(NO_CHANGE) : getJdChange(queueId)),
    [queueId],
    { enabled: open && queueId !== null },
  );

  const change = data ?? NO_CHANGE;
  const rows = change.changed ? diffJdText(change.before, change.after) : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={760}
      destroyOnHidden
      title={t("applyQueue.insights.jdChange.title")}
      // 只读对比：没有可提交的动作，所以按弹窗规范 `footer={null}`，关闭只走 ×/Esc。
      footer={null}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          title={t("applyQueue.insights.jdChange.passive")}
          description={
            change.seen_at
              ? t("applyQueue.insights.jdChange.seenAt", { time: formatDateTime(change.seen_at) })
              : t("applyQueue.insights.jdChange.seenAtUnknown")
          }
        />
        {queueId === null ? (
          // 记录上没带队列条目 id：明细按队列条目取，这里诚实地说"看不到"，不拿别的 id 猜。
          <EmptyState inline description={t("applyQueue.insights.jdChange.noId")} />
        ) : loading ? (
          <LoadingBlock />
        ) : error ? (
          <Alert type="error" showIcon title={t("applyQueue.insights.jdChange.error")} />
        ) : !change.changed ? (
          <EmptyState inline description={t("applyQueue.insights.jdChange.unchanged")} />
        ) : rows.length === 0 ? (
          <EmptyState inline description={t("applyQueue.insights.jdChange.empty")} />
        ) : (
          <>
            <Space size={8} wrap>
              <Tag color="red">{t("applyQueue.insights.jdChange.removed")}</Tag>
              <Tag color="green">{t("applyQueue.insights.jdChange.added")}</Tag>
              <Typography.Text type="secondary">
                {t("applyQueue.insights.jdChange.passive")}
              </Typography.Text>
            </Space>
            <div className="apply-jd-diff">
              <div className="apply-jd-diff-head">
                <div className="apply-jd-diff-cell">{t("applyQueue.insights.jdChange.before")}</div>
                <div className="apply-jd-diff-cell">{t("applyQueue.insights.jdChange.after")}</div>
              </div>
              {rows.map((row) => (
                <div className="apply-jd-diff-row" key={row.key}>
                  <DiffCell cell={row.left} label={t("applyQueue.insights.jdChange.before")} />
                  <DiffCell cell={row.right} label={t("applyQueue.insights.jdChange.after")} />
                </div>
              ))}
            </div>
          </>
        )}
      </Space>
    </Drawer>
  );
}
