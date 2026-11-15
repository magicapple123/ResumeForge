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
import { Alert, Typography } from "antd";
import type { ReactNode } from "react";
import type { ResearchBrief, ResearchSource } from "../../api/research";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { splitCitations } from "./citations";

/** 编号 → 来源。编号是 1 起的序号，所以按 `number` 建表而不是用数组下标。 */
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

export default function ResearchBriefPanel({ brief }: { brief: ResearchBrief }) {
  useLocale();
  const citationLabel = (number: number) => t("companyResearch.brief.citationAria", { number });

  if (brief.status === "failed") {
    // 简报失败时卡片照常展示（A 路已经搜过了），这里只说明原因。
    return (
      <Alert
        type="warning"
        showIcon
        title={t("companyResearch.brief.failed")}
        description={brief.reason || t("companyResearch.error.request")}
      />
    );
  }

  const sources = sourceIndex(brief.sources);
  return (
    <div className="rf-research-brief">
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
                </Typography.Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
