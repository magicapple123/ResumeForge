// SPDX-License-Identifier: Apache-2.0
/**
 * 全局搜索卡：跨岗位/简历/内推/提醒/面经/台账/资料/技能的统一搜索入口。
 * （自 HomePage 拆出：搜索 state×7、searchVersion ref、onSearch、
 * MORE_ORDER/MORE_HIT_META 随唯一消费者下沉。）
 */
import {
  AuditOutlined,
  CalendarOutlined,
  InboxOutlined,
  SolutionOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Alert, Card, Empty, Input, Listy, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { searchAll } from "../../api/search";
import type { SearchHitType, SearchResult } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 全局搜索"更多结果"分组的展示顺序与图标/标签（与后端下发顺序一致）。 */
const MORE_ORDER: SearchHitType[] = [
  "referral",
  "reminder",
  "experience",
  "claim",
  "material",
  "skill",
];

const MORE_HIT_META: Record<SearchHitType, { icon: ReactNode; labelKey: MessageKey }> = {
  referral: { icon: <TeamOutlined />, labelKey: "homePage.search.more.referral" },
  reminder: { icon: <CalendarOutlined />, labelKey: "homePage.search.more.reminder" },
  experience: { icon: <SolutionOutlined />, labelKey: "homePage.search.more.experience" },
  claim: { icon: <AuditOutlined />, labelKey: "homePage.search.more.claim" },
  material: { icon: <InboxOutlined />, labelKey: "homePage.search.more.material" },
  skill: { icon: <ToolOutlined />, labelKey: "homePage.search.more.skill" },
};

export function SearchCard() {
  // 本组件用模块级 t()，必须订阅语言变化。
  useLocale();
  const [searchText, setSearchText] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchVersion = useRef(0);

  useEffect(
    () => () => {
      searchVersion.current += 1;
    },
    [],
  );

  const onSearch = async (value: string) => {
    const keyword = value.trim();
    const currentSearch = ++searchVersion.current;
    if (!keyword) {
      setSearching(false);
      setSearched(false);
      setResult(null);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearched(true);
    setResult(null);
    setSearchError("");
    try {
      const nextResult = await searchAll(keyword);
      if (currentSearch === searchVersion.current) {
        setResult(nextResult);
      }
    } catch (error) {
      if (currentSearch === searchVersion.current) {
        setResult(null);
        setSearchError(error instanceof Error ? error.message : t("homePage.search.failed"));
      }
    } finally {
      if (currentSearch === searchVersion.current) setSearching(false);
    }
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("homePage.search.title")}
      </Typography.Title>
      <Input.Search
        placeholder={t("homePage.search.placeholder")}
        enterButton={t("homePage.search.action")}
        size="large"
        loading={searching}
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        onSearch={(value) => void onSearch(value)}
      />
      {searchError && <Alert type="error" showIcon title={searchError} style={{ marginTop: 16 }} />}
      {searched && (
        <div className="home-search-results">
          <Typography.Title level={5} type="secondary" style={{ margin: "8px 0" }}>
            {t("homePage.search.jobsTitle", { count: result?.jobs.length ?? 0 })}
          </Typography.Title>
          {(result?.jobs.length ?? 0) === 0 ? (
            <Empty description={t("homePage.search.jobsEmpty")} />
          ) : (
            <Listy
              items={result?.jobs ?? []}
              rowKey={(job) => job.id}
              itemRender={(job) => (
                <ListyItem>
                  <Space>
                    {/* 岗位有 id：直接深链打开该岗位（比 keyword 过滤精确）。 */}
                    <Link to={`/jobs?job_id=${job.id}`}>{job.title}</Link>
                    <Tag>{job.company}</Tag>
                    <Tag color="blue">{job.location}</Tag>
                    <Typography.Text type="secondary">
                      {job.salary || t("homePage.search.salaryNegotiable")}
                    </Typography.Text>
                  </Space>
                </ListyItem>
              )}
            />
          )}
          <Typography.Title level={5} type="secondary" style={{ margin: "8px 0" }}>
            {t("homePage.search.resumesTitle", { count: result?.resumes.length ?? 0 })}
          </Typography.Title>
          {(result?.resumes.length ?? 0) === 0 ? (
            <Empty description={t("homePage.search.resumesEmpty")} />
          ) : (
            <Listy
              items={result?.resumes ?? []}
              rowKey={(resume) => resume.id}
              itemRender={(resume) => (
                <ListyItem>
                  <Space>
                    {/* 简历深链：落地简历中心并直接打开详情（RF-11 搜索直开）。 */}
                    <Link to={`/resumes?resume_id=${resume.id}`}>{resume.title}</Link>
                    <Tag>{resume.job_title}</Tag>
                    <Typography.Text type="secondary">
                      {formatDateTime(resume.created_at)}
                    </Typography.Text>
                  </Space>
                </ListyItem>
              )}
            />
          )}
          {(result?.more.length ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <Typography.Title level={5} type="secondary" style={{ margin: "8px 0" }}>
                {t("homePage.search.moreTitle", { count: result?.more.length ?? 0 })}
              </Typography.Title>
              {MORE_ORDER.map((type) => {
                const hits = (result?.more ?? []).filter((hit) => hit.type === type);
                if (hits.length === 0) return null;
                const meta = MORE_HIT_META[type];
                return (
                  <div key={type} className="home-more-group">
                    <Space size={6} className="home-more-heading">
                      {meta.icon}
                      <Typography.Text type="secondary">
                        {t("homePage.search.groupHeading", {
                          name: t(meta.labelKey),
                          count: hits.length,
                        })}
                      </Typography.Text>
                    </Space>
                    <Listy
                      items={hits}
                      rowKey={(hit) => `${hit.type}-${hit.id}`}
                      itemRender={(hit) => (
                        <ListyItem>
                          <Space>
                            <Link to={hit.path}>{hit.title}</Link>
                            {hit.subtitle && (
                              <Typography.Text type="secondary">{hit.subtitle}</Typography.Text>
                            )}
                          </Space>
                        </ListyItem>
                      )}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
