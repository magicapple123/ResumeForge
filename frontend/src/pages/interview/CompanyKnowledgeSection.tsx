// SPDX-License-Identifier: Apache-2.0
/**
 * #29D：面试房间里的「这家公司面经 N 条」区块。
 *
 * 只读展示、不打断面试：
 * - 有 N 条（N>0）→ 显示计数按钮 + 前几条标题，点任意一处都跳到知识库并按公司筛选；
 * - 0 条 → 整块不渲染（面试进行中不拿空态占位置）；
 * - 加载中 → 一行灰字；接口失败 → 一行灰字 +「重试」（不用 toast 打断面试）。
 *
 * 数据口径：`related.total` 是后端精确匹配后的**全量**条数，不是 items.length；
 * 所以 N 条与标题行可能不一致（后端默认只回 5 条摘要），这是刻意的。
 */
import { BookOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  getCompanyKnowledgeRelated,
  knowledgeCompanyHref,
  type CompanyKnowledgeRelated,
} from "./companyKnowledge";
import "./interviewKnowledge.css";

/** 标题行最多摆几条：再多会把面试房间头部挤成第二屏。 */
const MAX_TITLE_LINKS = 3;

export function CompanyKnowledgeSection({ company }: { company: string }) {
  useLocale();
  const navigate = useNavigate();
  const trimmed = company.trim();
  const { data, loading, error, reload } = useApi<CompanyKnowledgeRelated>(
    () => getCompanyKnowledgeRelated(trimmed),
    [trimmed],
    { enabled: Boolean(trimmed) },
  );

  // 没有公司名（材料导入式面试可能没有）：无从按公司筛选，整块不出现。
  if (!trimmed) return null;

  const open = () => navigate(knowledgeCompanyHref(trimmed));

  if (loading) {
    return (
      <div className="interview-company-knowledge">
        <Typography.Text type="secondary" className="interview-company-knowledge__hint">
          {t("interviewKnowledge.loading")}
        </Typography.Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="interview-company-knowledge">
        <Typography.Text type="secondary" className="interview-company-knowledge__hint">
          {t("interviewKnowledge.error")}
        </Typography.Text>
        <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => void reload()}>
          {t("interviewKnowledge.retry")}
        </Button>
      </div>
    );
  }

  // 0 条：不显示（判据是 total，不是 items.length）。
  if (!data || data.total <= 0) return null;

  return (
    <div className="interview-company-knowledge">
      <Button
        type="link"
        size="small"
        icon={<BookOutlined />}
        className="interview-company-knowledge__count"
        onClick={open}
      >
        {t("interviewKnowledge.title", { count: data.total })}
      </Button>
      {data.items.length > 0 ? (
        <span className="interview-company-knowledge__titles">
          {data.items.slice(0, MAX_TITLE_LINKS).map((item) => (
            <Button
              key={item.id}
              type="link"
              size="small"
              className="interview-company-knowledge__title"
              aria-label={t("interviewKnowledge.openItem", { title: item.title })}
              onClick={open}
            >
              {item.title}
            </Button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export default CompanyKnowledgeSection;
