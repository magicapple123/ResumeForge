// SPDX-License-Identifier: Apache-2.0
/** 助手消息的安全 Markdown 子集、附件和来源展示。 */

import {
  ExportOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  PushpinFilled,
  StarFilled,
} from "@ant-design/icons";
import { Collapse, Image, Tag, Tooltip, Typography } from "antd";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AssistantAttachment, AssistantSource, AssistantSourceNumber } from "../../../types";
import { MessageToolCalls } from "./MessageToolCalls";

import {
  attachmentStyle,
  canPreviewImage,
  isMarkdownTableDivider,
  parseMarkdownTableRow,
  renderInlineMarkdown,
} from "../assistantUtils";

/** 文档按扩展名区分图标：pdf 和 docx 混在一串标签里时，图标比文件名更好认。 */
function attachmentIcon(name: string, kind: string) {
  if (kind !== "document") return <FileTextOutlined />;
  return name.toLowerCase().endsWith(".pdf") ? <FilePdfOutlined /> : <FileWordOutlined />;
}

function AssistantMessageContentBase({
  content,
  sourceMap,
}: {
  content: string;
  /** [来源N] 的「编号 → url」映射；缺省时正文里的 [来源N] 保持纯文本。 */
  sourceMap?: AssistantSourceNumber[];
}) {
  // 解析结果按 content 缓存：历史消息的 content 不变时，逐行解析（含表格重组）不必重跑。
  const blocks = useMemo<ReactNode[]>(() => {
    const lines = content.split(/\r?\n/);
    const result: ReactNode[] = [];

    for (let index = 0; index < lines.length; index += 1) {
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
        result.push(
          <h4 key={`heading-${index}`}>{renderInlineMarkdown(heading[1], sourceMap)}</h4>,
        );
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
  }, [content, sourceMap]);

  return <div className="assistant-message-content assistant-message-content--rich">{blocks}</div>;
}

/**
 * 流式期间每个 delta 都会让页面级 state（streamingText）更新、整棵助手页重渲染；
 * 历史气泡的 props（content 字符串 + sourceMap 数组引用）不变，包一层 memo 把它们挡在
 * 渲染之外——否则长对话下每次 delta 都要对全部历史消息重新 split 全文 + 逐行解析。
 */
export const AssistantMessageContent = memo(AssistantMessageContentBase);

export function StreamingStatus({ message }: { message: string }) {
  return (
    <div className="assistant-streaming-status" role="status">
      <span className="assistant-streaming-dot" aria-hidden="true" />
      <span>{message}</span>
      <span className="assistant-streaming-ellipsis" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

export function ConversationTitle({
  title,
  pinned,
  favorite,
  onSelect,
}: {
  title: string;
  pinned: boolean;
  favorite: boolean;
  onSelect: () => void;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;

    const updateOverflowDistance = () => {
      const nextDistance = Math.max(0, element.scrollWidth - element.clientWidth);
      setOverflowDistance((current) => (current === nextDistance ? current : nextDistance));
    };
    updateOverflowDistance();

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateOverflowDistance);
    observer?.observe(element);
    window.addEventListener("resize", updateOverflowDistance);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateOverflowDistance);
    };
  }, [title]);

  return (
    <Tooltip title={title} placement="right">
      <button
        type="button"
        className="assistant-conversation-button"
        aria-label={title}
        onClick={onSelect}
      >
        {(pinned || favorite) && (
          <span className="assistant-conversation-flags" aria-hidden="true">
            {pinned && <PushpinFilled />}
            {favorite && <StarFilled />}
          </span>
        )}
        <span
          ref={titleRef}
          className={
            overflowDistance > 0
              ? "assistant-conversation-title is-overflowing"
              : "assistant-conversation-title"
          }
          style={attachmentStyle(overflowDistance)}
        >
          <span>{title}</span>
        </span>
      </button>
    </Tooltip>
  );
}

export function MessageAttachments({
  attachments,
}: {
  attachments: Array<
    AssistantAttachment | { name: string; kind: "text" | "image" | "document"; data: string }
  >;
}) {
  if (!attachments.length) return null;
  const notes = attachments.flatMap((attachment) =>
    "notes" in attachment ? attachment.notes : [],
  );
  return (
    <div className="assistant-message-attachments">
      {attachments.map((attachment, index) => {
        const dataUrl = "data_url" in attachment ? attachment.data_url : attachment.data;
        const mimeType = "mime_type" in attachment ? attachment.mime_type : "";
        if (attachment.kind === "image" && dataUrl && canPreviewImage(mimeType)) {
          return (
            <Image
              key={`${attachment.name}-${index}`}
              src={dataUrl}
              alt={attachment.name}
              className="assistant-message-image"
            />
          );
        }
        return (
          // 文件名是用户给的，长度没有上限；标签本身不换行，不截断就会顶出气泡。
          <Tooltip key={`${attachment.name}-${index}`} title={attachment.name}>
            <Tag
              className="assistant-attachment-tag"
              icon={attachmentIcon(attachment.name, attachment.kind)}
            >
              {attachment.name}
            </Tag>
          </Tooltip>
        );
      })}
      {notes.length > 0 && <span className="assistant-attachment-notes">{notes.join("；")}</span>}
    </div>
  );
}

/**
 * 模型的思考过程；开启思考强度后才有内容。
 *
 * 照抄 `MessageSources` 的折叠面板模式：**默认折叠**（不传 `defaultActiveKey`），
 * 标题「思考过程」，用户点开即可查看。**没有内容时整块不渲染**——这是安全降级：
 * 不开思考、或更早存下的历史消息里没有 `reasoning` 字段时，界面与加这个功能之前
 * 完全一致，不会凭空多出一个空面板。
 *
 * 无障碍：折叠头由 antd 渲染成可聚焦的 `role="button"`，本身支持回车/空格开关；
 * 这里额外挂 `aria-label` 固定名称、并用 `data-testid` 提供给测试，避免依赖会被
 * antd 自动插入空格的中文可见文本（两字中文标签会被拆开，按文本查询会找不到）。
 */
export function MessageReasoning({
  reasoning,
  truncated = false,
  active = false,
}: {
  reasoning?: string;
  truncated?: boolean;
  /** 正在流式思考时为 true：标题旁亮脉冲点，思考结束后停（A2）。 */
  active?: boolean;
}) {
  if (!reasoning || !reasoning.trim()) return null;
  return (
    <Collapse
      className={`assistant-reasoning${active ? " assistant-reasoning--active" : ""}`}
      size="small"
      data-testid="message-reasoning"
      items={[
        {
          key: "reasoning",
          label: (
            <span className="assistant-reasoning-label" aria-label="思考过程">
              思考过程
              {active && <span className="assistant-reasoning-dot" aria-hidden="true" />}
            </span>
          ),
          children: (
            <div className="assistant-reasoning-body">
              <div className="assistant-reasoning-text" style={{ whiteSpace: "pre-wrap" }}>
                {reasoning}
              </div>
              {truncated && (
                <Typography.Text type="secondary" className="assistant-reasoning-truncated">
                  思考过程过长，这里只保留了前一部分。
                </Typography.Text>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

export function MessageSources({ sources }: { sources: AssistantSource[] }) {
  if (!sources.length) return null;
  return (
    <Collapse
      className="assistant-sources"
      size="small"
      items={[
        {
          key: "sources",
          label: `参考来源（${sources.length}）`,
          children: (
            <ol>
              {sources.map((source) => (
                <li key={source.url}>
                  <Typography.Link
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="assistant-source-title"
                  >
                    {source.title || source.url}
                    {/* 标题默认就是一段普通文字，用户不会想到能点。外链图标把"可跳转"摆在
                        明面上；aria-hidden 是因为图标自带 aria-label（"export"），不隐藏
                        会并进链接的无障碍名称，读屏时在"招聘官网"后面念一句"export"没意义。 */}
                    <ExportOutlined aria-hidden className="assistant-source-icon" />
                  </Typography.Link>
                  {source.snippet && (
                    <Typography.Text type="secondary">{source.snippet}</Typography.Text>
                  )}
                </li>
              ))}
            </ol>
          ),
        },
      ]}
    />
  );
}

// 兼容再导出：既有调用方从 AssistantMessageContent 拿 MessageToolCalls。
export { MessageToolCalls };
