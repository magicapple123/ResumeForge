// SPDX-License-Identifier: Apache-2.0
/**
 * 安全 Markdown 子集（块级）：标题 / 列表 / 管道表格 / 段落，行内交给
 * `renderInlineMarkdown`（粗体、代码、链接、[来源N]、裸 URL）。
 *
 * 为什么要有这一个组件：助手页与面试页都在显示模型输出，而模型输出是 Markdown。
 * 之前面试页直接插值，于是 `**` 与 `-` 原样裸露。两处各写一份解析迟早漂移，所以块级
 * 解析只留这一份实现，助手页与面试页共用。
 *
 * 安全边界：输出的是 React 节点，**没有** `dangerouslySetInnerHTML`——`<script>` 之类
 * 会被当成普通文本画出来，`javascript:` 链接被 `safeExternalUrl` 挡成纯文本。
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { AssistantSourceNumber } from "../../types";
import {
  isMarkdownTableDivider,
  parseMarkdownTableRow,
  renderInlineMarkdown,
} from "../../features/assistant/assistantUtils";

/** 逐行解析成块级节点；每个块都带 key，列表与表格的兄弟节点才不会每次重建 DOM。 */
function parseMarkdownBlocks(content: string, sourceMap?: AssistantSourceNumber[]): ReactNode[] {
  const lines = content.split(/\r?\n/);
  const result: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    // 表格要先于段落判：表头行本身也是一行普通文本，顺序反了就会被当成段落。
    const tableHeader = parseMarkdownTableRow(lines[index]);
    if (tableHeader && isMarkdownTableDivider(lines[index + 1] ?? "", tableHeader.length)) {
      const rows: string[][] = [];
      let nextIndex = index + 2;
      while (nextIndex < lines.length) {
        const row = parseMarkdownTableRow(lines[nextIndex]);
        if (!row || row.length !== tableHeader.length) break;
        rows.push(row);
        nextIndex += 1;
      }
      result.push(
        <div key={`table-${index}`} className="assistant-markdown-table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {tableHeader.map((cell, cellIndex) => (
                  <th key={`header-${cellIndex}`}>{renderInlineMarkdown(cell, sourceMap)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>
                      {renderInlineMarkdown(cell, sourceMap)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = nextIndex - 1;
      continue;
    }

    const line = lines[index];
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (heading) {
      result.push(<h4 key={`heading-${index}`}>{renderInlineMarkdown(heading[1], sourceMap)}</h4>);
      continue;
    }
    if (bullet || ordered) {
      result.push(
        <div key={`list-${index}`} className="assistant-markdown-list-item">
          <span aria-hidden="true">{ordered ? `${ordered[1]}.` : "•"}</span>
          <div>{renderInlineMarkdown(bullet?.[1] ?? ordered?.[2] ?? "", sourceMap)}</div>
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      result.push(<div key={`space-${index}`} className="assistant-markdown-spacer" />);
      continue;
    }
    result.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(line, sourceMap)}</p>);
  }

  return result;
}

export function MarkdownBlock({
  content,
  sourceMap,
}: {
  content: string;
  /** [来源N] 的「编号 → url」映射；面试页不传，正文里的 [来源N] 保持纯文本。 */
  sourceMap?: AssistantSourceNumber[];
}) {
  // 解析结果按 content 缓存：历史消息的正文不变时，逐行解析（含表格重组）不必重跑。
  const blocks = useMemo(() => parseMarkdownBlocks(content, sourceMap), [content, sourceMap]);
  return (
    // 复用助手消息的排版作用域（`styles/assistant-content.css` 里的
    // `.assistant-message-content--rich`）：两处显示的是同一份 Markdown，规则不该有两套。
    <div className="assistant-message-content assistant-message-content--rich markdown-block">
      {blocks}
    </div>
  );
}

export default MarkdownBlock;
