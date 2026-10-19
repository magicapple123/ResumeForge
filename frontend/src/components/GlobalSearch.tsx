/**
 * 全站搜索（R6）：页头右上角的放大镜 + ⌘/Ctrl+K，在**任何页面**都能搜。
 *
 * 此前搜索只存在于首页那张卡片里：人在简历页想找一条面经，得先回首页。
 * 这里复用既有 `GET /api/search`（七个数据域，FTS5），只做一个弹层，不另造检索逻辑。
 *
 * 交互上只有四条规矩：输入 250ms 防抖（连打不连发请求）、结果按"岗位 / 简历 / 其它"
 * 分组、点一条（或用 ↑↓ 选中后回车）就跳转并关掉弹层、Esc 关闭。空输入不请求——
 * "打开就发一次空查询"既浪费也会把结果区闪成一片空白。
 */
import { SearchOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Modal, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  // R6：键盘导航共用一份「当前高亮」——鼠标 hover 也只改这个下标，不会出现两套高亮。
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ⌘/Ctrl+K：任何页面都能唤起。录制快捷键时 keymap 会让位（见 isShortcutRecording）。
  useShortcut("search", (event) => {
    event.preventDefault();
    setActiveIndex(-1);
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
        .then((data) => {
          setResult(data);
          // 新结果：旧的选中项已经没有意义，下一次 ↓ 从第一条开始。
          setActiveIndex(-1);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "搜索失败"))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const total = useMemo(() => {
    if (!result) return 0;
    return result.jobs.length + result.resumes.length + result.more.length;
  }, [result]);

  /** 跨分组扁平化后的跳转目标：键盘上下移动走这一份，渲染分组只是它的切片。 */
  const hits = useMemo(() => {
    if (!result) return [];
    return [
      ...result.jobs.map((job) => ({ key: `job-${job.id}`, path: `/jobs?job_id=${job.id}` })),
      ...result.resumes.map((resume) => ({
        key: `resume-${resume.id}`,
        path: `/resumes?resume_id=${resume.id}`,
      })),
      ...result.more.map((hit) => ({ key: `${hit.type}-${hit.id}`, path: hit.path })),
    ];
  }, [result]);

  // 键盘移到视口外时把它滚进来（`block:"nearest"` 不会把整页顶跳）。
  useEffect(() => {
    if (activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-hit-index="${activeIndex}"]`);
    // jsdom 没有实现 scrollIntoView：可选调用既让测试通过，也不影响真实浏览器。
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      const hit = hits[activeIndex];
      if (hit) {
        event.preventDefault();
        go(hit.path);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (hits.length === 0) return;
    event.preventDefault();
    // 首尾循环：未选中时 ↓ 落到第一条、↑ 落到最后一条；已选中时按模运算绕回。
    setActiveIndex((current) => {
      const down = event.key === "ArrowDown";
      if (current < 0) return down ? 0 : hits.length - 1;
      const step = down ? 1 : -1;
      return (current + step + hits.length) % hits.length;
    });
  };

  /** 结果项的统一交互：键盘高亮与鼠标 hover 写同一个 `activeIndex`。 */
  const hitProps = (index: number) => ({
    "data-hit-index": index,
    "aria-selected": index === activeIndex,
    onMouseEnter: () => setActiveIndex(index),
  });

  return (
    <>
      <Tooltip title="全站搜索（Ctrl/⌘ + K）">
        <Button
          type="text"
          icon={<SearchOutlined />}
          aria-label="全站搜索"
          onClick={() => {
            setActiveIndex(-1);
            setOpen(true);
          }}
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
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />
        <div style={{ marginTop: 12 }} ref={listRef}>
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
                  {result.jobs.map((job, index) => (
                    <button
                      key={`job-${job.id}`}
                      type="button"
                      className="global-search-hit"
                      {...hitProps(index)}
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
                  {result.resumes.map((resume, index) => (
                    <button
                      key={`resume-${resume.id}`}
                      type="button"
                      className="global-search-hit"
                      {...hitProps(result.jobs.length + index)}
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
                  {result.more.map((hit, index) => (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      type="button"
                      className="global-search-hit"
                      {...hitProps(result.jobs.length + result.resumes.length + index)}
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
