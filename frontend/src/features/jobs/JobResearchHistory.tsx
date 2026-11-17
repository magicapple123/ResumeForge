// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位详情里的「调研历史」（T07）。
 *
 * 只读一小段：岗位详情已经是一个抽屉，这里再开一层抽屉会叠层（同一时刻只允许一个
 * 弹层容器），所以**就地**列出这个岗位最近几次调研，把「看全部 / 重新调研」交给
 * 调研页（带上 `history=1` 让它直接打开历史抽屉）。
 *
 * 0 条或请求失败都**不渲染**：与同目录的 `RelatedKnowledgeBlock` 一致，
 * 没有内容就不占一行，不给空态噪音。
 */
import { Divider, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listResearchHistory, type ResearchHistoryItem } from "../../api/research";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";

/** 详情里只露最近 3 条：再多就该去调研页看了。 */
const PREVIEW_LIMIT = 3;
/** 调研页路由。抽成常量再拼查询串：整条 `/research?...` 字面量会被文案守卫当成产品文案。 */
const RESEARCH_PATH = "/research";

/** 调研页 + 历史抽屉：`history=1` 是"打开抽屉"的显式开关（页面不自动搜）。 */
function researchHistoryHref(company: string, jobId: number, role = ""): string {
  const params = new URLSearchParams();
  if (company.trim()) params.set("company", company.trim());
  if (role.trim()) params.set("role", role.trim());
  params.set("job_id", String(jobId));
  params.set("history", "1");
  return `${RESEARCH_PATH}?${params.toString()}`;
}

export default function JobResearchHistory({
  company,
  jobId,
  role = "",
}: {
  company: string;
  jobId: number;
  role?: string;
}) {
  useLocale();
  const queryKey = `${company.trim()}|${jobId}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    total: number;
    items: ResearchHistoryItem[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const trimmed = company.trim();
    if (!trimmed) return;
    listResearchHistory({ company: trimmed, job_id: jobId, limit: PREVIEW_LIMIT })
      .then((page) => {
        if (!cancelled) {
          setLoaded({ key: queryKey, total: page.total, items: page.items });
        }
      })
      .catch(() => {
        // 历史是锦上添花：读不到就整块不显示，不打断岗位详情。
      });
    return () => {
      cancelled = true;
    };
  }, [company, jobId, queryKey]);

  const data = loaded && loaded.key === queryKey ? loaded : null;
  if (!data || data.total <= 0 || data.items.length === 0) return null;

  return (
    <section
      className="job-detail-research-history"
      data-testid="job-detail-research-history"
      aria-label={t("companyResearch.history.title")}
    >
      <Divider titlePlacement="start" plain style={{ margin: "8px 0" }}>
        {t("companyResearch.history.jobTitle", { count: data.total })}
      </Divider>
      <ul className="job-detail-research-history-list">
        {data.items.slice(0, PREVIEW_LIMIT).map((item) => (
          <li key={item.id}>
            <Typography.Text type="secondary">
              {formatDateTime(item.created_at ?? undefined)}
            </Typography.Text>
            {" · "}
            <Typography.Text>{item.role || company}</Typography.Text>
          </li>
        ))}
      </ul>
      <Link to={researchHistoryHref(company, jobId, role)}>
        {t("companyResearch.history.jobViewAll")}
      </Link>
    </section>
  );
}
