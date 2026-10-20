// SPDX-License-Identifier: Apache-2.0
/** 更新说明（Release notes markdown 子集）的轻量渲染器。
 *
 * 后端把 GitHub Release 的正文原样带回来，里面是 `## 新增`、`- **xxx** yyy` 这样的
 * markdown；此前当纯文本直出，用户看到的就是一行行星号和井号。这里做**不引入
 * markdown 依赖**的最小解析，只认发布说明里实际出现的几种语法：
 * - `## 标题` → 五号标题（antd Typography.Title level=5，与卡片其余文字层级相称）；
 * - `- ` 开头的行 → 无序列表（连续的 `-` 行合并进同一个 ul）；
 * - `**粗体**` → strong（成对才认，与 UserGuideModal 的 renderEmphasis 同一规则）；
 * - 空行分段；其余行按普通段落。
 */

import { Typography } from "antd";
import type { ReactNode } from "react";

/** 把一段文字里的 `**强调**` 渲染成 strong（同 UserGuideModal.renderEmphasis 的规则）。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    // split 带捕获组时，奇数下标就是被 `**` 包住的那段。
    index % 2 === 1 ? <strong key={`${keyPrefix}-${index}`}>{part}</strong> : part,
  );
}

export function renderReleaseNotes(notes: string): ReactNode[] {
  const lines = notes.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const key = `notes-ul-${blocks.length}`;
    blocks.push(
      <ul key={key} style={{ margin: "0 0 4px", paddingLeft: 20 }}>
        {listItems.map((item, index) => (
          <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      return;
    }
    flushList();
    if (!trimmed) return; // 空行只负责分段
    if (trimmed.startsWith("## ")) {
      blocks.push(
        <Typography.Title key={index} level={5} style={{ marginBottom: 4 }}>
          {renderInline(trimmed.slice(3), `h-${index}`)}
        </Typography.Title>,
      );
      return;
    }
    blocks.push(
      <Typography.Paragraph key={index} style={{ marginBottom: 4 }}>
        {renderInline(trimmed, `p-${index}`)}
      </Typography.Paragraph>,
    );
  });
  flushList();
  return blocks;
}
