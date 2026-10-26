// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情里的「本次使用」追溯行（R-33）+ 资料变更后「需重新生成」提示（R-36 相邻口径）。
 *
 * 三条产品口径，只在这一处实现：
 * - 已保存简历**不随切组/改资料变化**，所以显示的是保存时的**快照**，不是当前组；
 * - 快照里的组被删除后仍然显示历史（组名/参与大字段照旧）并标注「组已删除」；
 * - 资料/组定义在快照之后变了 → 提示"需重新生成才会体现在纸面上"，但**绝不自动改正文**。
 *
 * 读取失败**静默降级**（返回 null，不阻断简历详情）：这条是辅助信息，不是主内容；
 * 请求在 effect 里发出，换一份简历/关弹窗后回来的旧响应会被 cancelled 标志丢弃。
 */
import { Alert, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { getResumeProfileUsage } from "../../api/resumes";
import type { ProfileUsageFreshness, ResumeProfileUsageSnapshot } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 简历记录 id；详情弹窗换记录时重新取快照。 */
  recordId: number;
}

/** 快照里参与大字段的显示名；空清单用统一文案，不拼空串。 */
function fieldNamesText(snapshot: ResumeProfileUsageSnapshot): string {
  const names = snapshot.participating
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0
    ? names.join(t("profileGroups.summary.separator"))
    : t("profileGroups.summary.empty");
}

export default function ResumeProfileUsage({ recordId }: Props) {
  useLocale();
  const [snapshot, setSnapshot] = useState<ResumeProfileUsageSnapshot | null>(null);
  const [freshness, setFreshness] = useState<ProfileUsageFreshness | null>(null);
  // 换一份简历：清掉上一份的快照（渲染期守卫，避免 effect 里同步 setState 级联渲染）。
  const [prevRecordId, setPrevRecordId] = useState(recordId);
  if (prevRecordId !== recordId) {
    setPrevRecordId(recordId);
    setSnapshot(null);
    setFreshness(null);
  }

  useEffect(() => {
    let cancelled = false;
    void getResumeProfileUsage(recordId)
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data.profile_usage ?? null);
        setFreshness(data.freshness ?? null);
      })
      .catch(() => {
        // 静默降级：读不到就不显示这条辅助信息（详情主内容照常可用）。
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (!snapshot) return null;
  const deleted = snapshot.group_deleted;
  return (
    <div style={{ marginBottom: 12 }}>
      <Space size={8} wrap>
        <Tooltip title={fieldNamesText(snapshot)}>
          {/* tabIndex：键盘聚焦也能展开字段名（Tooltip 的键盘等价入口）。 */}
          <Typography.Text tabIndex={0} style={{ cursor: "help" }}>
            {t("profileGroups.summary.label", {
              name: snapshot.group_name,
              count: snapshot.participating.length,
            })}
          </Typography.Text>
        </Tooltip>
        {deleted ? (
          <Tooltip title={t("resume.detail.group-usage.deleted-hint")}>
            <Tag tabIndex={0} style={{ cursor: "help" }}>
              {t("resume.detail.group-usage.deleted")}
            </Tag>
          </Tooltip>
        ) : null}
      </Space>
      {freshness?.changed ? (
        <Alert
          style={{ marginTop: 8 }}
          type="warning"
          showIcon
          title={t("resume.detail.group-usage.stale-title")}
          description={t("resume.detail.group-usage.stale-body")}
        />
      ) : null}
    </div>
  );
}
