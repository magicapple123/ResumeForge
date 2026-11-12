// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位详情「相关知识 N 条」（#29D）：29B 存进知识库的条目按公司/岗位回溯到岗位详情。
 *
 * 判定口径：优先按公司名（知识条目的 company 列）查；公司为空才退回 job_id。
 * 0 条 / 请求失败都**不渲染**（页面既有形态是"没有内容就不占一行"，不给空态噪音）。
 * 条目与标题都带 href 跳到 /knowledge?q=…（知识库不在 Router 里也能用的既有写法）。
 */
import { Divider, Typography } from "antd";
import { useEffect, useState } from "react";
import { request } from "../../api/client";
import { t } from "../../i18n";
import { knowledgeCategoryLabel } from "../../i18n/enum/knowledge";
import { useLocale } from "../../i18n/i18nContext";

/** 和后端 /knowledge/related 的 limit 上限一致：详情里只露出最近 5 条。 */
const MAX_RELATED_ITEMS = 5;

interface RelatedKnowledgeItem {
  id: number;
  title: string;
  category: string;
}

interface RelatedKnowledgeResponse {
  total: number;
  items: RelatedKnowledgeItem[];
}

function knowledgeHref(query: string): string {
  return `/knowledge?q=${encodeURIComponent(query.trim())}`;
}

export default function RelatedKnowledgeBlock({
  company,
  jobId,
}: {
  company: string;
  jobId: number;
}) {
  useLocale();
  // 响应带查询键：岗位切换后旧结果自然失配（不用在 effect 里同步 setState 清空，
  // 那会触发 cascading render —— react-hooks/set-state-in-effect 会报）。
  const queryKey = `${company.trim()}|${jobId}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    data: RelatedKnowledgeResponse;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(MAX_RELATED_ITEMS) });
    const trimmedCompany = company.trim();
    if (trimmedCompany) params.set("company", trimmedCompany);
    else params.set("job_id", String(jobId));
    request<RelatedKnowledgeResponse>(`/knowledge/related?${params.toString()}`)
      .then((response) => {
        if (!cancelled) setLoaded({ key: queryKey, data: response });
      })
      .catch(() => {
        // 关联区块是锦上添花：查不到就整块不显示，不打断岗位详情主流程。
      });
    return () => {
      cancelled = true;
    };
  }, [company, jobId, queryKey]);

  const related = loaded && loaded.key === queryKey ? loaded.data : null;
  if (!related || related.total <= 0 || related.items.length === 0) return null;
  const items = related.items.slice(0, MAX_RELATED_ITEMS);
  const viewAllQuery = company.trim();

  return (
    <section
      className="job-detail-related-knowledge"
      data-testid="job-detail-related-knowledge"
      aria-label={t("jobDetail.relatedKnowledge.aria")}
    >
      <Divider titlePlacement="start" plain style={{ margin: "8px 0" }}>
        {t("jobDetail.relatedKnowledge.title", { count: related.total })}
      </Divider>
      <ul className="job-detail-related-knowledge-list">
        {items.map((item) => (
          <li key={item.id}>
            <Typography.Link href={knowledgeHref(item.title)}>{item.title}</Typography.Link>
            {item.category ? (
              <Typography.Text type="secondary">
                {" · "}
                {knowledgeCategoryLabel(item.category)}
              </Typography.Text>
            ) : null}
          </li>
        ))}
      </ul>
      {viewAllQuery ? (
        <Typography.Link
          href={knowledgeHref(viewAllQuery)}
          className="job-detail-related-knowledge-all"
        >
          {t("jobDetail.relatedKnowledge.viewAll")}
        </Typography.Link>
      ) : null}
    </section>
  );
}
