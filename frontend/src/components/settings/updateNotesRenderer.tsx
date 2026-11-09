// SPDX-License-Identifier: Apache-2.0
/** 更新说明（Release notes markdown 子集）的轻量渲染器。
 *
 * 后端把 GitHub Release 的正文原样带回来，里面是 `# 标题`、表格、`---`、行内代码、
 * 链接这样的 markdown；此前当纯文本直出，用户看到的就是一行行井号、管道符和反引号。
 * 这里做**不引入 markdown 依赖**的最小解析：只把发布说明里实际出现的语法翻译成 React
 * 元素。全程走 React 文本节点，**没有** `dangerouslySetInnerHTML`——这是"解析 markdown
 * 子集"，不是"渲染 HTML"。
 *
 * 支持的语法（括号里是线上 v2.0.0 公告里出现过的实例）：
 * - `#{1,4} 标题` → Typography.Title level=5（`# ResumeForge 2.0.0`）；
 * - 连续 `| … |` 行 + `| --- |` 分隔行 → 原生 table（「要不要升」「下载」两张表）；
 * - `---` / `***` / `___` 单独一行 → hr；
 * - `- ` / `* ` → ul，`1. ` → ol（连续同类行合并成同一个列表）；
 * - `**粗体**` → strong（成对才认，与 UserGuideModal 的 renderEmphasis 同一规则）；
 * - `` `行内代码` `` → code（`C++`、`legacy-archive/<时间戳>/files/`）；
 * - `[文字](地址)` → 链接（**只放行 http/https**；其余只留 link text，见 renderLink）；
 * - 空行分段；其余行按普通段落。
 *
 * 关于 key：全部用**数字**（列表起始行号 / 表格起始行号 / 段落的行号 / 单元格序号），
 * 不拼 `p-3`、`notes-table-2` 这类字符串。`src/i18n/cjkRatchet` 的 AST product-copy
 * 扫把 JSX 表达式里出现的模板串当"产品文案"（`renderInline(x, \`h-${i}\`)` 会被记成
 * `h-{}` 一条），key 前缀只是为了 React 排重、并不显示给用户，不该为此消耗文案预算；
 * 数字 key 在同级数组里本来就唯一，够用。
 */

import { Typography } from "antd";
import type { CSSProperties, ReactNode } from "react";

/* 表格与代码的边框/底色一律走主题变量：`--rf-border`、`--rf-surface-alt` 在亮色
   （design-tokens.css）与暗色（dark-tokens.css）下都有定义；写死 `rgba(0,0,0,.12)`
   这类值，在暗色主题里边框等于看不见。 */
const TABLE_STYLE: CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  margin: "0 0 8px",
  fontSize: "inherit",
};

const CELL_STYLE: CSSProperties = {
  border: "1px solid var(--rf-border)",
  padding: "5px 6px",
  textAlign: "left",
  verticalAlign: "top",
};

const CODE_STYLE: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  background: "var(--rf-surface-alt)",
  borderRadius: 2,
  padding: "0 3px",
  fontSize: "0.92em",
};

const LIST_STYLE: CSSProperties = { margin: "0 0 4px", paddingLeft: 20 };

const PARAGRAPH_STYLE: CSSProperties = { marginBottom: 4 };

const HEADING_STYLE: CSSProperties = { marginTop: 0, marginBottom: 4 };

const HR_STYLE: CSSProperties = {
  border: "none",
  borderTop: "1px solid var(--rf-border)",
  margin: "10px 0",
};

const LINK_STYLE: CSSProperties = { wordBreak: "break-word" };

/* 行内语法：`**粗体**` / `` `代码` `` / `[文字](地址)`。地址里允许一层括号，
   这样 `[x](javascript:alert(1))` 能被完整识别出来、交给白名单判掉，而不是靠
   "正则没匹配上"侥幸不变链接。 */
const INLINE_PATTERN =
  /(\*\*[\s\S]+?\*\*)|(`[^`]+`)|\[([^[\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g;

/** 协议白名单：只有绝对 http/https 地址才变成链接。 */
const SAFE_HREF = /^https?:\/\//i;

/* 表格：一行要首尾都是 `|`；分隔行是 `| --- | --- |`（允许 `:---:` 对齐写法）。 */
const TABLE_ROW = /^\|.*\|$/;
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;

/** 标题、分隔线、两种列表 —— 都是一眼可判的行级语法。 */
const HEADING_LINE = /^(#{1,4})\s+(.+)$/;
const HR_LINE = /^(-{3,}|\*{3,}|_{3,})$/;
const BULLET_LINE = /^[-*]\s+(.+)$/;
const ORDERED_LINE = /^(\d{1,3})[.)]\s+(.+)$/;

/** 把 `|` 行切成单元格（去掉首尾竖线后按 `|` 分）。 */
function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

/** 这一行是不是表格的对齐分隔行（`| --- | :---: |`）。 */
function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell));
}

/** `[文字](地址)` → `<a>`；协议不在白名单里就**只渲染文字**，地址直接丢掉。 */
function renderLink(label: string, url: string, key: number): ReactNode {
  const target = url.trim();
  // javascript: / data: / 相对路径（`docs/upgrading.md`）都走这里：不生成 `<a>`，
  // 连地址都不进 DOM，只留 link text。真实 v2.0.0 公告那句
  // 「完整步骤见 [docs/upgrading.md](docs/upgrading.md)。」因此显示成
  // 「完整步骤见 docs/upgrading.md。」——用户不会再看到裸露的方括号与圆括号，
  // 而 `javascript:` 这类地址连字符串都不会出现在页面上。
  if (!SAFE_HREF.test(target) || /\s/.test(target)) {
    return label;
  }
  return (
    <a key={key} href={target} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
      {label}
    </a>
  );
}

/** 把一段文字里的 `**强调**` / `` `代码` `` / `[文字](地址)` 渲染成对应元素。 */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 模块级正则带 `g`，靠 lastIndex 迭代；每次进来先归零，否则第二次调用会从中间开始。
  INLINE_PATTERN.lastIndex = 0;
  let cursor = 0;
  let index = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[1] !== undefined) {
      // 第 1 组是 `**…**`：去壳后当 strong 的文本。
      nodes.push(<strong key={index}>{match[1].slice(2, -2)}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(
        <code key={index} style={CODE_STYLE}>
          {match[2].slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(renderLink(match[3] ?? "", match[4] ?? "", index));
    }
    cursor = match.index + match[0].length;
    index += 1;
    match = INLINE_PATTERN.exec(text);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** 一张表：首个 `|` 行进 thead，其余进 tbody；列数按最多的一行补齐空单元格。 */
function renderTable(rows: string[][], blockKey: number): ReactNode {
  const columns = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const normalize = (cells: string[]): string[] => {
    const padded = cells.slice(0, columns);
    while (padded.length < columns) padded.push("");
    return padded;
  };
  const header = normalize(rows[0] ?? []);
  const body = rows.slice(1).map(normalize);
  return (
    <table key={blockKey} style={TABLE_STYLE}>
      <thead>
        <tr>
          {header.map((cell, column) => (
            <th key={column} style={CELL_STYLE}>
              {renderInline(cell)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((cells, row) => (
          <tr key={row}>
            {cells.map((cell, column) => (
              <td key={column} style={CELL_STYLE}>
                {renderInline(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 正在攒的列表：同类行合并，类型一变就先收尾。 */
type ListBuffer = { ordered: boolean; start: number; startLine: number; items: string[] };

export function renderReleaseNotes(notes: string): ReactNode[] {
  const lines = String(notes ?? "").split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: ListBuffer = { ordered: false, start: 1, startLine: -1, items: [] };

  const flushList = () => {
    if (list.items.length === 0) return;
    const items = list.items.map((item, index) => (
      <li key={index} style={{ marginBottom: 2 }}>
        {renderInline(item)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        // `start` 让 `3. …` 开头的列表不跳号；key 用列表起始行号。
        <ol
          key={list.startLine}
          start={list.start === 1 ? undefined : list.start}
          style={LIST_STYLE}
        >
          {items}
        </ol>
      ) : (
        <ul key={list.startLine} style={LIST_STYLE}>
          {items}
        </ul>
      ),
    );
    list = { ordered: false, start: 1, startLine: -1, items: [] };
  };

  const pushListItem = (item: string, ordered: boolean, start: number, line: number) => {
    // 有序/无序混着出现时各成一个列表，不要合成一个有数字有无圆点的怪物。
    if (list.items.length > 0 && list.ordered !== ordered) flushList();
    if (list.items.length === 0) {
      list.ordered = ordered;
      list.start = start;
      list.startLine = line;
    }
    list.items.push(item);
  };

  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();

    // 空行只负责分段：把攒着的列表收掉，别的一概不做。
    if (!trimmed) {
      flushList();
      index += 1;
      continue;
    }

    // 表格：先吃掉连续的 `| … |` 行，再看第二行是不是分隔行——是才是表格。
    if (TABLE_ROW.test(trimmed)) {
      const rows: string[] = [];
      let next = index;
      while (next < lines.length && TABLE_ROW.test(lines[next].trim())) {
        rows.push(lines[next].trim());
        next += 1;
      }
      if (rows.length >= 2 && isTableSeparator(rows[1])) {
        flushList();
        // 分隔行本身不渲染；首行当表头，其余当数据行。key 用表格起始行号。
        const cells = [splitTableRow(rows[0]), ...rows.slice(2).map(splitTableRow)];
        blocks.push(renderTable(cells, index));
        index = next;
        continue;
      }
      // 竖线行但不像表格（没有分隔行）：别丢内容，按普通段落连成一句显示。
      flushList();
      blocks.push(
        <Typography.Paragraph key={index} style={PARAGRAPH_STYLE}>
          {renderInline(rows.join(" "))}
        </Typography.Paragraph>,
      );
      index = next;
      continue;
    }

    if (HR_LINE.test(trimmed)) {
      flushList();
      blocks.push(<hr key={index} style={HR_STYLE} />);
      index += 1;
      continue;
    }

    const heading = HEADING_LINE.exec(trimmed);
    if (heading) {
      flushList();
      blocks.push(
        // `###` 及更深不单列层级：卡片里放不下四级字号，统一五号。
        <Typography.Title key={index} level={5} style={HEADING_STYLE}>
          {renderInline(heading[2])}
        </Typography.Title>,
      );
      index += 1;
      continue;
    }

    const bullet = BULLET_LINE.exec(trimmed);
    if (bullet) {
      pushListItem(bullet[1], false, 1, index);
      index += 1;
      continue;
    }

    const ordered = ORDERED_LINE.exec(trimmed);
    if (ordered) {
      // 记下首个序号：`3. …` 开头的列表用 start 保持编号不跳。
      pushListItem(ordered[2], true, Number.parseInt(ordered[1], 10), index);
      index += 1;
      continue;
    }

    flushList();
    blocks.push(
      <Typography.Paragraph key={index} style={PARAGRAPH_STYLE}>
        {renderInline(trimmed)}
      </Typography.Paragraph>,
    );
    index += 1;
  }

  flushList();
  return blocks;
}
