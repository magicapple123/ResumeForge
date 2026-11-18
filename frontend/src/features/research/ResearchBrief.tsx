// SPDX-License-Identifier: Apache-2.0
/**
 * 联网简报（T07 · B 路产出）：Markdown 精简渲染 + 编号引用。
 *
 * 为什么自己渲染而不引 Markdown 库：简报只有三种块（标题 / 段落 / 无序列表），
 * 而**编号引用必须是站内链接**——通用 Markdown 渲染会把 `[1]` 当成链接语法或纯文本，
 * 用户点了不会有任何反应。这里把 `[n]` 单独切出来，映射到后端给的同号来源。
 *
 * 安全口径：正文来自模型，只当**纯文本**渲染（不注入 HTML），所以不存在 XSS 通道；
 * 链接都是后端过滤过 scheme 的 http(s) 地址。
 */
import { Alert, Button, Typography } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ResearchBrief, ResearchSource } from "../../api/research";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { splitCitations } from "./citations";

/** 编号 → 来源。编号是 1 起的序号，所以按 `number` 建表而不是用数组下标。 */
/** 来源的域名（列表里显示 `[n] 标题 — 域名`，用户不点开也能判断出处）。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function sourceIndex(sources: ResearchSource[]): Map<number, ResearchSource> {
  const map = new Map<number, ResearchSource>();
  for (const source of sources) map.set(source.number, source);
  return map;
}

function renderLine(
  line: string,
  sources: Map<number, ResearchSource>,
  lineIndex: number,
  citationLabel: (number: number) => string,
): ReactNode[] {
  return splitCitations(line).map((token, index) => {
    if (typeof token === "string") return token;
    const source = sources.get(token.citation);
    // Key 只用数字拼：这个函数的入参会经过一道"是否属于界面文案"的静态检查，
    // 带字母的前缀会被当成文案，而 React key 不是文案。
    const key = `${lineIndex}-${index}`;
    if (!source) {
      // 编号指向不存在的来源：原样显示，不编一个链接出来。
      return <span key={key}>[{token.citation}]</span>;
    }
    return (
      <a
        key={key}
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="rf-research-citation"
        aria-label={citationLabel(token.citation)}
        title={source.title}
      >
        [{token.citation}]
      </a>
    );
  });
}

/** 极简 Markdown：`##` 标题、`-` 列表、其余按段落。 */
function renderMarkdown(
  markdown: string,
  sources: Map<number, ResearchSource>,
  citationLabel: (number: number) => string,
): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[][] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`list-${blocks.length}`} className="rf-research-brief-list">
        {items.map((nodes, index) => (
          <li key={index}>{nodes}</li>
        ))}
      </ul>,
    );
  };

  markdown.split("\n").forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
      flushList();
      blocks.push(
        <Typography.Title key={String(lineIndex)} level={5} className="rf-research-brief-heading">
          {renderLine(line.replace(/^#{1,3}\s+/, ""), sources, lineIndex, citationLabel)}
        </Typography.Title>,
      );
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(renderLine(line.slice(2), sources, lineIndex, citationLabel));
      return;
    }
    flushList();
    blocks.push(
      <Typography.Paragraph key={String(lineIndex)} className="rf-research-brief-paragraph">
        {renderLine(line, sources, lineIndex, citationLabel)}
      </Typography.Paragraph>,
    );
  });
  flushList();
  return blocks;
}

/** 失败分类 → 可行动作。没有按钮的失败（upstream）只说明原因。 */
function failureAction(
  code: ResearchBrief["reason_code"],
): { label: string; to: string } | { label: string; retry: true } | null {
  if (code === "unauthorized") {
    return {
      label: t("companyResearch.brief.action.openSettings"),
      to: "/settings?tab=connections",
    };
  }
  if (code === "insufficient_balance") {
    return { label: t("companyResearch.brief.action.checkBalance"), to: "/settings?tab=model" };
  }
  if (code === "rate_limited") {
    // 429 时整屏重跑没必要：卡片已经搜过了，只重跑简报即可（后端 parts 白名单）。
    return { label: t("companyResearch.brief.action.retryLater"), retry: true };
  }
  return null;
}

export default function ResearchBriefPanel({
  brief,
  onRetryBrief,
}: {
  brief: ResearchBrief;
  onRetryBrief?: () => void;
}) {
  useLocale();
  const citationLabel = (number: number) => t("companyResearch.brief.citationAria", { number });

  if (brief.status === "skipped") {
    return <Typography.Text type="secondary">{t("companyResearch.brief.skipped")}</Typography.Text>;
  }

  if (brief.status === "failed") {
    // 简报失败时卡片照常展示（A 路已经搜过了），这里只说明原因 + 给一个能点的下一步。
    const action = failureAction(brief.reason_code);
    return (
      <Alert
        type="warning"
        showIcon
        title={t("companyResearch.brief.failed")}
        description={brief.reason || t("companyResearch.error.request")}
        action={
          action && "to" in action ? (
            <Link to={action.to}>
              <Button size="small">{action.label}</Button>
            </Link>
          ) : action && onRetryBrief ? (
            <Button size="small" onClick={onRetryBrief}>
              {action.label}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const sources = sourceIndex(brief.sources);
  const meta = [
    brief.deep ? t("companyResearch.brief.meta.deep") : t("companyResearch.brief.meta.standard"),
    t("companyResearch.brief.meta.sources", { count: brief.sources.length }),
    brief.elapsed_ms
      ? t("companyResearch.brief.meta.elapsed", { seconds: (brief.elapsed_ms / 1000).toFixed(1) })
      : "",
  ].filter(Boolean);
  return (
    <div className="rf-research-brief">
      {/* 顶部元信息：深度/来源数/耗时。用户先知道"这份东西值不值得读"。 */}
      <div className="rf-research-brief-meta">{meta.join(" · ")}</div>
      {/* 结论带：v2 的「一句话结论」单独成块。旧简报没有 lead 时不渲染空块。 */}
      {brief.lead ? <div className="rf-research-brief-lead">{brief.lead}</div> : null}
      {renderMarkdown(brief.markdown, sources, citationLabel)}
      {brief.sources.length === 0 ? (
        <Typography.Text type="secondary">{t("companyResearch.brief.noSources")}</Typography.Text>
      ) : (
        <>
          <Typography.Title level={5} className="rf-research-brief-heading">
            {t("companyResearch.brief.sources")}
          </Typography.Title>
          <ol className="rf-research-brief-sources">
            {brief.sources.map((source) => (
              <li key={source.number}>
                <Typography.Link href={source.url} target="_blank" rel="noreferrer">
                  [{source.number}] {source.title}
                  {hostOf(source.url) ? ` — ${hostOf(source.url)}` : ""}
                </Typography.Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
