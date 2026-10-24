// SPDX-License-Identifier: Apache-2.0
/**
 * 页边距控件（T5 搬迁 → 项 4a 滑块化 → 四向页边距的"总"）：从导出面板搬进预览的排版栏。
 *
 * 为什么搬家：页边距决定的是「眼前这份简历长什么样」，不是「导出成什么文件」。把它放在
 * 导出面板里，用户必须先开面板才能调版面，而且调完面板一关就看不到效果。搬过来之后
 * 与行距/字号并列，改完立刻重渲染。
 *
 * 为什么从数字框改成滑块（4a / D5）：三个控件（字号 / 行距 / 页边距）是同一类操作——
 * "边看边找，直到看着合适"。`InputNumber` 是"我已经知道要填 14"的思维，版式调整 100% 属于
 * 另一种。形态与 `LineHeightControl` 同构（防抖、两端 ±、读数、随模板、复位），这样三行的
 * 视觉与手感一致。
 *
 * ## 从"一个值"到"总 + 四条支路"之后，这个控件只剩三种状态
 *
 * | 状态 | 含义 | 滑块位置 | 读数 |
 * |---|---|---|---|
 * | `unset` | 既没有 `page_padding` 也没有支路 | 模板默认值 | `14mm` + 「随模板」 |
 * | `uniform` | 只有 `page_padding`（或四条恰好全等） | 该值 | `14mm` |
 * | `custom` | 四条支路齐全且不全等 | **上边距** | `自定义` + 悬停看四边 |
 *
 * 拖动 = `withUniformMargin`：写 `page_padding` 并删掉四条支路 → **一次拖动即从"自定义"
 * 回到"统一"**（需求 d 的唯一入口）。这也是设计 §9 拍板的"清空"语义：它可逆，而"总滑杆
 * 点了没反应"是不可逆的困惑。
 *
 * 取值范围与落点只有一份实现：`utils/pageMargins.ts`（`MIN/MAX` 与后端逐字一致，
 * `clampPageMargin` 负责收口）。这里只管交互，不重复定义常量。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import type { PageMargins } from "../../utils/pageMargins";
import {
  MAX_PAGE_MARGIN,
  MIN_PAGE_MARGIN,
  PAGE_MARGIN_STEP,
  clampPageMargin,
} from "../../utils/pageMargins";
import { pagePaddingProbeCss } from "../../utils/resumeFormatProbe";
import ParamResetButton from "./ParamResetButton";

/**
 * 提交防抖（毫秒）。
 *
 * 与行距同一档：页边距没有本地探针，每次提交都要后端重渲染一次，所以比字号的 180ms
 * 更保守——120ms 足以把一次拖动折叠成一次请求，又短到松手后几乎立刻看到结果。
 */
const COMMIT_DEBOUNCE_MS = 120;

/**
 * 总滑杆的三种状态，由**两个布尔量**推导（不是三个独立 prop）：
 *
 * - `customized === false` → `unset`（什么都没设过，读数带来源标签）；
 * - `customized === true && uniform` → `uniform`（四边相等，写着用户自己选的值）；
 * - `customized === true && !uniform` → `custom`（四条支路齐全且不全等）。
 *
 * 为什么不用 `state: "unset" | "uniform" | "custom"` 这一个 prop：`customized` 与
 * `uniform` 都是父组件手里已有的现成事实（`hasMarginOverrides` / `marginsAreUniform`），
 * 多一层映射只多一处可能写错的地方。非法组合（`false + false`）在这里没有意义，
 * 也不会有第二种解释。
 */
export type PagePaddingState = "unset" | "uniform" | "custom";

interface Props {
  /** 当前生效的页边距；单位 mm。**四边不全等时父组件传的是上边距**（`resolvePageMargins().top`）。 */
  value: number;
  /** 用户是否动过页边距（`page_padding` 或任意一条支路）。 */
  customized: boolean;
  /** 四边是否全等（`marginsAreUniform`）。`customized && !uniform` 即"自定义"态。 */
  uniform: boolean;
  /** 四边读数：自定义态的悬停说明用；其余状态可省略。 */
  margins?: PageMargins;
  disabled?: boolean;
  /** 没设过覆盖时显示的来源标签：随模板 / 随版式（选了版式预设时）。 */
  defaultHint?: string;
  /** 「恢复到打开时的值」：`visible` 为真时长出右侧那颗 ↺（见 `utils/paramRestore`）。 */
  restore?: { visible: boolean; onReset: () => void };
  /** 传数值 = 写入覆盖（并清掉四条支路）；传 `null` = 连四条支路一起清（回到随模板）。 */
  onChange: (pagePadding: number | null) => void;
  /**
   * 拖动中的即时反馈（项 6 / D10）：与后端 `css_rule` 逐字一致的 CSS。
   * 传空串 = 清掉探针（复位时）。
   */
  onProbe?: (css: string) => void;
}

export default function PagePaddingControl({
  value,
  customized,
  uniform,
  margins,
  disabled = false,
  defaultHint,
  restore,
  onChange,
  onProbe,
}: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 四边不全等 → 这个位置上**没有**一个页边距值。滑块停在父组件给的上边距（§5.1）：
  // 拖动它就等于"把整体拉回来"，回程只需要一次拖动。
  const custom = customized && !uniform;

  // 父组件确认了新值（提交成功或外部改动）后交回权威值，避免滑块停在中间态。
  // 三态一起进签名：`custom` → `uniform` 的那一次切换也必须清掉拖动中的值。
  const signature = `${value}:${customized}:${uniform}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDragging(null);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // 0.1mm 步长下浮点尾巴会漏到读数与落库值里，统一走同一个收口函数：
  // 越界值（历史草稿 / 程序化赋值）必须与后端白名单说同一件事。
  const shown = clampPageMargin(dragging ?? value);

  const commit = (next: number) => {
    const rounded = clampPageMargin(next);
    setDragging(rounded);
    // 即时反馈先于提交：探针与最终渲染是同一条规则的同一种数字格式（D10）。
    onProbe?.(pagePaddingProbeCss(rounded));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChange(rounded);
    }, COMMIT_DEBOUNCE_MS);
  };

  const reset = () => {
    if (!customized) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDragging(null);
    onProbe?.("");
    // 四边一起清（`page_padding` 与四条支路），而不是写回模板默认值：
    // 模板以后更新默认页边距时，这些简历才跟着变。
    onChange(null);
  };

  /** 四边读数的悬停说明（`上 8 · 右 12 · 下 12 · 左 12`），只保留一位小数。 */
  const customHint = margins
    ? t("resume.pagePadding.customHint", {
        top: Number(margins.top.toFixed(1)),
        right: Number(margins.right.toFixed(1)),
        bottom: Number(margins.bottom.toFixed(1)),
        left: Number(margins.left.toFixed(1)),
      })
    : "";

  return (
    // `wrap`：这一行在窄窗口里会贴着左右边缘，宁可在必要时把尾部折到第二行，
    // 也不要让它被压成 0 宽（那样胶囊会溢出、被相邻控件盖住）。
    <Space size={6} wrap>
      {/* 双击标题恢复默认（原先是末尾的 ↺ 按钮）。
          提示走 Tooltip 而不是原生 title：后者只对鼠标可见（理由同 LineHeightControl）。
          Tooltip 不产生 DOM，`<span>` 仍是 `Space` 的直接子节点。 */}
      <Tooltip title={t("resume.pagePadding.resetTooltip")}>
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label={t("resume.pagePadding.resetLabel")}
          onDoubleClick={reset}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          {t("resume.pagePadding.label")}
        </span>
      </Tooltip>
      <Space size={2} align="center">
        <Button
          size="small"
          type="text"
          icon={<MinusOutlined />}
          aria-label={t("resume.pagePadding.decrease")}
          disabled={disabled || shown <= MIN_PAGE_MARGIN}
          onClick={() => commit(shown - PAGE_MARGIN_STEP)}
        />
        <Slider
          className="resume-page-padding-slider"
          min={MIN_PAGE_MARGIN}
          max={MAX_PAGE_MARGIN}
          step={PAGE_MARGIN_STEP}
          value={shown}
          disabled={disabled}
          aria-label={t("resume.pagePadding.sliderLabel")}
          ariaLabelForHandle={t("resume.pagePadding.label")}
          tooltip={{
            formatter: (value) => (value == null ? "" : `${Number(Number(value).toFixed(1))}mm`),
          }}
          style={{ flex: "1 1 70px", minWidth: 56, margin: "0 2px" }}
          onChange={commit}
        />
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label={t("resume.pagePadding.increase")}
          disabled={disabled || shown >= MAX_PAGE_MARGIN}
          onClick={() => commit(shown + PAGE_MARGIN_STEP)}
        />
      </Space>
      {/* 读数与来源标签各占一列（定宽，见 modules.css），与行距那一行落在同一条竖线上。
          四边不全等时读数写「自定义」：这个位置上**没有**一个页边距值，写某个数字都是撒谎。
          精确的四边读数在悬停气泡里（Tooltip 而不是 title，同上一条理由）。 */}
      <span className="resume-measure-tail">
        {custom ? (
          <Tooltip title={customHint}>
            <Typography.Text type="secondary" className="resume-measure-value">
              {t("resume.pagePadding.custom")}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary" className="resume-measure-value">
            {Number(shown.toFixed(1))}mm
          </Typography.Text>
        )}
        {/* 「随模板」只在没设过覆盖时出现：设过之后这个数字就是用户自己的选择，
            再标"随模板"会让人以为模板一改自己的值也会跟着变。位置始终保留，
            否则拖一下滑杆读数就会右移。 */}
        <span className={`resume-measure-source${customized ? " is-empty" : ""}`}>
          {restore?.visible ? (
            <ParamResetButton label={t("resume.pagePadding.label")} onReset={restore.onReset} />
          ) : customized ? (
            ""
          ) : (
            (defaultHint ?? t("resume.measure.hintTemplate"))
          )}
        </span>
      </span>
    </Space>
  );
}
