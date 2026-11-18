// SPDX-License-Identifier: Apache-2.0
/**
 * 长提示的**唯一**载体：一行短句 + `ⓘ`，点开才给完整说明。
 *
 * ## 为什么不直接用 antd Tooltip
 *
 * Tooltip 只适合「这是什么」这种 ≤20 字的补充；一旦塞进 60~100 字的参数解释，它就
 * 变成"悬停才看得见的说明书"——触屏与键盘用户根本读不到，鼠标用户也读不完（鼠标一
 * 移开就没了）。本仓库实测有 16 条这样的长 tooltip（见
 * `deliverables/ResumeForge-issue-backlog-2026-11-16.md` 的 I-17）。
 *
 * 所以长提示统一收成这个组件：
 *
 * - **默认**：`ⓘ` 是一个真正的按钮（可 Tab、可 Enter），点开是 Popover——内容常驻到
 *   用户点别处，不会"鼠标移开就消失"；
 * - **提示模式**（`features/help-mode`，快捷键 `Alt+H`）：所有 `ⓘ` 改成**原地内联展开**，
 *   一次看全所有说明，再按一次退出。
 *
 * 调用点**不要**各写一套 Tooltip/Popover：文案长度不同、可访问性行为不同，最后一定会
 * 漂成两种交互。
 *
 * ## 可访问性
 *
 * 触发按钮的名字由调用方给（`label`，通常是「某某说明」），因为 `ⓘ` 这个字本身对读屏
 * 没有意义；内联展开时整块用 `role="note"` 并按同一句 `label` 命名，读屏用户听到的是
 * "说明：<正文>"，而不是一段凭空出现的话。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { Popover, Space } from "antd";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useEffect } from "react";
import { registerHint, useHelpMode } from "../../features/help-mode/helpModeStore";
import "./hint-detail.css";

export interface HintDetailProps {
  /** 完整说明（长文案，通常是语言包里那条被替下来的 tooltip）。空串时组件不渲染。 */
  detail: string;
  /** 触发按钮的无障碍名（「某某说明」）；提示模式下同一句用作整块的 aria-label。 */
  label: string;
  /**
   * 可选的一行短句，跟在 `ⓘ` 前面。字段自己的 label 已经说明了"是什么"时不要传，
   * 否则同一句话会在同一行里出现两次。
   */
  summary?: string;
  className?: string;
  /**
   * 排版：`inline`（默认）用于表单 label / 段落里；`block` 用于表格「动作」列这类窄列。
   *
   * I-28：表格列约 200px，把 45 字说明塞进 `inline-flex` 会被挤成 4~5 行竖条、行高爆炸；
   * `block` 让 `summary` 与正文各占一行（`width: 100%`），列宽不变、只长高。
   * **默认必须保持 inline**——表单 label 里换成 block 会把同一行拆成两行。
   */
  variant?: "inline" | "block";
}

/** 触发按钮与内联块共用的一套排版：12px、次要文字色、不参与行高撑开。 */
const BASE_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--rf-text-description)",
};

const TRIGGER_STYLE: CSSProperties = {
  ...BASE_STYLE,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "pointer",
};

const WRAP_STYLE: CSSProperties = {
  ...BASE_STYLE,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const INLINE_STYLE: CSSProperties = {
  ...BASE_STYLE,
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: 4,
};

/** I-28：表格 / 窄列的竖排——标签一行、正文一行，宽度跟着列走。 */
const BLOCK_STYLE: CSSProperties = {
  ...BASE_STYLE,
  display: "block",
  width: "100%",
  marginTop: 2,
};

/**
 * 正文容器：`pre-line` 让 `detail` 里的 `\n` 真的换行。
 *
 * 有的说明本身是好几段（例如接口协议那 188 字 + 支持面 + 思考形态三段），拼成一个
 * 字符串传进来是最省心的（调用方不必传 JSX，也就不会两处各写一套排版）；没有 `\n`
 * 的普通文案在 `pre-line` 下与 `normal` 完全一致，所以这一条对所有调用点都是安全的。
 */
const DETAIL_STYLE: CSSProperties = {
  display: "block",
  maxWidth: 320,
  whiteSpace: "pre-line",
};

/**
 * 长提示：`ⓘ` + 点击弹出详情；提示模式下原地展开。
 *
 * 参数与用法见 `HintDetailProps`；本组件自己不读语言包——文案全部由调用方 `t()` 之后传入，
 * 语言切换时的重渲染责任也就留在调用方（与仓库其它"纯展示"组件一致）。
 */
export function HintDetail({
  detail,
  label,
  summary,
  className,
  variant = "inline",
}: HintDetailProps) {
  const helpMode = useHelpMode();
  const text = detail.trim();
  const block = variant === "block";

  // I-28：挂载即登记，**与提示模式无关**——徽标要显示"本页 N 条说明"，这个数在进入
  // 模式之前就必须成立。空说明不参与计数（它的 ⓘ 根本不渲染）。
  useEffect(() => {
    if (text === "") return undefined;
    return registerHint();
  }, [text]);

  if (text === "") return null;

  // 提示模式：就在原地展开，用户不必逐个点开。
  if (helpMode) {
    return (
      <span
        className={className}
        role="note"
        aria-label={label}
        data-help-mode="active"
        style={block ? BLOCK_STYLE : INLINE_STYLE}
      >
        {summary ? <span style={block ? { display: "block" } : undefined}>{summary}</span> : null}
        <span
          style={block ? { display: "block", whiteSpace: "pre-line" } : { whiteSpace: "pre-line" }}
        >
          {text}
        </span>
      </span>
    );
  }

  return (
    <span className={className} style={block ? BLOCK_STYLE : WRAP_STYLE}>
      {summary ? <span>{summary}</span> : null}
      <Popover content={<span style={DETAIL_STYLE}>{text}</span>} trigger="click" placement="top">
        <button
          type="button"
          aria-label={label}
          // 这个按钮常挂在 antd `Form.Item` 的 label 里，而 label 默认会把点击转成
          // "聚焦那个输入框"。拦掉默认行为，点 `ⓘ` 只开说明。
          onClick={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
          style={TRIGGER_STYLE}
        >
          <InfoCircleOutlined aria-hidden="true" />
        </button>
      </Popover>
    </span>
  );
}

export default HintDetail;

export interface HintLabelProps {
  /** 字段自己的名字（多半是 `t()` 的结果；技术名词如 `Base URL` 可直接给字面量）。 */
  text: ReactNode;
  /** 完整说明（长文案）。 */
  detail: string;
  /** `ⓘ` 的无障碍名（"某某说明"）——见 `HintDetailProps.label`。 */
  hintLabel: string;
}

/**
 * 「标签 + `ⓘ`」：`Form.Item` 的 `label` 位、或工具栏里"字段名 + 说明"这一对。
 *
 * 提到这里而不是各处就地写 `<Space>{label}<HintDetail/></Space>` 的原因：同一个手势在
 * 三个设置面板里出现（先进参数网格、模型记录弹窗），各写一份必然漂成"有的换行、有的
 * 贴住、有的 gap 是 4 有的是 6"。`wrap={false}` 与弹窗里其它受控列同口径——label 折行
 * 会让同一行几列的高度参差。
 *
 * 技术名词（`Top P` / `Base URL`）走 `text` 属性而不是 JSX 文本子节点：JSX 文本会被
 * 仓库的"新增界面文案"棘轮当成未登记的产品文案，而属性名 `text` 不在它的判定清单里
 * （见 `i18n/guards/productCopyRules.ts`）。
 */
export function HintLabel({ text, detail, hintLabel }: HintLabelProps) {
  return (
    <Space size={4} wrap={false}>
      {text}
      <HintDetail detail={detail} label={hintLabel} />
    </Space>
  );
}
