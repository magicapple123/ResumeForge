// SPDX-License-Identifier: Apache-2.0
/**
 * 语义检索结果面板（#29A）。
 *
 * 开关在筛选条上；本面板只在「开了语义检索且有关键词」时渲染。命中优先显示后端给的
 * summary 片段（snippet），点结果由页面取详情后打开原文。三条状态一个不少：
 * loading（LoadingBlock）/ error（ErrorState + 重试）/ empty（EmptyState inline）。
 * 向量路不可用时后端在 fallback_reason 里说明，这里如实展示而不是假装语义命中。
 */
import { Alert, Button, Tag, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import LoadingBlock from "../common/LoadingBlock";
import { searchKnowledge } from "../../api/knowledge";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  query: string;
  company: string;
  onOpen: (id: number) => void;
}

export default function SemanticSearchPanel({ query, company, onOpen }: Props) {
  useLocale();
  // useApi 的三态（loading/error/data）+ enabled：没有关键词就不发请求，也不挂骨架。
  const { data, loading, error, reload } = useApi(
    () => searchKnowledge({ q: query.trim(), company: company || undefined, limit: 20 }),
    [query, company],
    { enabled: query.trim().length > 0 },
  );

  if (loading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorState
        description={t("knowledgePage.semantic.error", { error })}
        onRetry={() => void reload()}
      />
    );
  }
  const items = data?.items ?? [];
  return (
    <div>
      <Typography.Text strong>{t("knowledgePage.semantic.title")}</Typography.Text>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        {t("knowledgePage.semantic.hint")}
      </Typography.Text>
      {data?.fallback_reason ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={t("knowledgePage.semantic.fallback", { reason: data.fallback_reason })}
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState inline description={t("knowledgePage.semantic.empty")} />
      ) : (
        <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none" }}>
          {items.map((hit) => (
            <li key={hit.id} style={{ marginBottom: 8 }}>
              <Button
                type="link"
                style={{ padding: 0, height: "auto", textAlign: "start", whiteSpace: "normal" }}
                onClick={() => onOpen(hit.id)}
              >
                <Typography.Text strong>{hit.title}</Typography.Text>
              </Button>
              {hit.snippet ? (
                <Typography.Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ marginBottom: 0 }}
                >
                  {hit.snippet}
                </Typography.Paragraph>
              ) : null}
              <Tag color={hit.used_vector ? "blue" : "default"}>
                {hit.used_vector
                  ? t("knowledgePage.semantic.vectorTag")
                  : t("knowledgePage.semantic.keywordTag")}
              </Tag>
              <Tag>{t("knowledgePage.semantic.score", { score: hit.score.toFixed(2) })}</Tag>
              {hit.matched_heading ? <Tag>{hit.matched_heading}</Tag> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
