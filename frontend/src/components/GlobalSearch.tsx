/**
 * 全站搜索（R6）：页头右上角的放大镜 + ⌘/Ctrl+K，在**任何页面**都能搜。
 *
 * 此前搜索只存在于首页那张卡片里：人在简历页想找一条面经，得先回首页。
 * 这里复用既有 `GET /api/search`（七个数据域，FTS5），只做一个弹层，不另造检索逻辑。
 *
 * 交互上只有三条规矩：输入 250ms 防抖（连打不连发请求）、结果按"岗位 / 简历 / 其它"
 * 分组、点一条就跳转并关掉弹层。空输入不请求——"打开就发一次空查询"既浪费也会把
 * 结果区闪成一片空白。
 */
import { SearchOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Modal, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchAll } from "../api/search";
import { useShortcut } from "../features/shortcuts/useShortcutKeymap";
import type { SearchResult } from "../types";

const DEBOUNCE_MS = 250;

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ⌘/Ctrl+K：任何页面都能唤起。录制快捷键时 keymap 会让位（见 isShortcutRecording）。
  useShortcut("search", (event) => {
    event.preventDefault();
    setOpen(true);
  });

  useEffect(() => {
    const keyword = query.trim();
    if (!open || !keyword) {
      setResult(null);
      setLoading(false);
      setError("");
      return undefined;
    }
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      searchAll(keyword)
        .then((data) => setResult(data))
        .catch((err) => setError(err instanceof Error ? err.message : "搜索失败"))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const total = useMemo(() => {
    if (!result) return 0;
    return result.jobs.length + result.resumes.length + result.more.length;
  }, [result]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <>
      <Tooltip title="全站搜索（Ctrl/⌘ + K）">
        <Button
          type="text"
          icon={<SearchOutlined />}
          aria-label="全站搜索"
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <Modal
        title="全站搜索"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(620px, 94vw)"
        destroyOnHidden
      >
        <Input
          allowClear
          autoFocus
          value={query}
          placeholder="搜索岗位、简历、内推、提醒、面经、台账、资料…"
          aria-label="搜索关键词"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div style={{ marginTop: 12 }}>
          {!query.trim() ? (
            <Typography.Text type="secondary">
              输入关键词开始搜索；结果只来自你自己的本机数据，不会联网。
            </Typography.Text>
          ) : error ? (
            <Typography.Text type="danger">{error}</Typography.Text>
          ) : loading && !result ? (
            <Space>
              <Spin size="small" />
              <Typography.Text type="secondary">搜索中…</Typography.Text>
            </Space>
          ) : result && total === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的内容" />
          ) : result ? (
            <Space orientation="vertical" size={10} style={{ width: "100%" }}>
              {result.jobs.length > 0 && (
                <div>
                  <Typography.Text strong>岗位</Typography.Text>
                  {result.jobs.map((job) => (
                    <button
                      key={`job-${job.id}`}
                      type="button"
                      className="global-search-hit"
                      onClick={() => go(`/jobs?job_id=${job.id}`)}
                    >
                      <span>{job.title}</span>
                      <Typography.Text type="secondary">{job.company}</Typography.Text>
                    </button>
                  ))}
                </div>
              )}
              {result.resumes.length > 0 && (
                <div>
                  <Typography.Text strong>简历</Typography.Text>
                  {result.resumes.map((resume) => (
                    <button
                      key={`resume-${resume.id}`}
                      type="button"
                      className="global-search-hit"
                      onClick={() => go(`/resumes?resume_id=${resume.id}`)}
                    >
                      <span>{resume.title}</span>
                      <Typography.Text type="secondary">
                        {resume.company || resume.job_title || "通用简历"}
                      </Typography.Text>
                    </button>
                  ))}
                </div>
              )}
              {result.more.length > 0 && (
                <div>
                  <Typography.Text strong>其它</Typography.Text>
                  {result.more.map((hit) => (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      type="button"
                      className="global-search-hit"
                      onClick={() => go(hit.path)}
                    >
                      <span>
                        <Tag>{hit.type}</Tag>
                        {hit.title}
                      </span>
                      <Typography.Text type="secondary">{hit.subtitle}</Typography.Text>
                    </button>
                  ))}
                </div>
              )}
            </Space>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
