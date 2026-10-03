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
import { createSearchParams, Link } from "react-router-dom";
import { searchAll } from "../../api/search";
import type { SearchHitType, SearchResult } from "../../types";
import { formatDateTime } from "../../utils/format";

/** 全局搜索"更多结果"分组的展示顺序与图标/标签（与后端下发顺序一致）。 */
const MORE_ORDER: SearchHitType[] = [
  "referral",
  "reminder",
  "experience",
  "claim",
  "material",
  "skill",
];

const MORE_HIT_META: Record<SearchHitType, { icon: ReactNode; label: string }> = {
  referral: { icon: <TeamOutlined />, label: "内推" },
  reminder: { icon: <CalendarOutlined />, label: "提醒" },
  experience: { icon: <SolutionOutlined />, label: "面经" },
  claim: { icon: <AuditOutlined />, label: "事实台账" },
  material: { icon: <InboxOutlined />, label: "资料" },
  skill: { icon: <ToolOutlined />, label: "技能" },
};

export function SearchCard() {
  const [searchText, setSearchText] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [resultKeyword, setResultKeyword] = useState("");
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
      setResultKeyword("");
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
        setResultKeyword(keyword);
      }
    } catch (error) {
      if (currentSearch === searchVersion.current) {
        setResult(null);
        setSearchError(error instanceof Error ? error.message : "搜索失败，请重试");
      }
    } finally {
      if (currentSearch === searchVersion.current) setSearching(false);
    }
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        全局搜索
      </Typography.Title>
      <Input.Search
        placeholder="搜索岗位、简历，或内推、提醒、面经、台账、资料、技能，如：市场营销 / 财务会计"
        enterButton="搜索"
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
            匹配的岗位（{result?.jobs.length ?? 0}）
          </Typography.Title>
          {(result?.jobs.length ?? 0) === 0 ? (
            <Empty description="没有匹配的岗位" />
          ) : (
            <Listy
              items={result?.jobs ?? []}
              rowKey={(job) => job.id}
              itemRender={(job) => (
                <ListyItem>
                  <Space>
                    <Link to={`/jobs?${createSearchParams({ keyword: resultKeyword })}`}>
                      {job.title}
                    </Link>
                    <Tag>{job.company}</Tag>
                    <Tag color="blue">{job.location}</Tag>
                    <Typography.Text type="secondary">{job.salary || "薪资面议"}</Typography.Text>
                  </Space>
                </ListyItem>
              )}
            />
          )}
          <Typography.Title level={5} type="secondary" style={{ margin: "8px 0" }}>
            匹配的简历记录（{result?.resumes.length ?? 0}）
          </Typography.Title>
          {(result?.resumes.length ?? 0) === 0 ? (
            <Empty description="没有匹配的简历记录" />
          ) : (
            <Listy
              items={result?.resumes ?? []}
              rowKey={(resume) => resume.id}
              itemRender={(resume) => (
                <ListyItem>
                  <Space>
                    <Link to="/resumes">{resume.title}</Link>
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
                更多结果（{result?.more.length ?? 0}）
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
                        {meta.label}（{hits.length}）
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
