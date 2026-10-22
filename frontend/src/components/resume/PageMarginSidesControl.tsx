// SPDX-License-Identifier: Apache-2.0
/**
 * 分边页边距（四行支路）：上 / 右 / 下 / 左，各自一条滑杆。
 *
 * 为什么**默认收起**（§5.2 / §9 ④）：绝大多数用户只要"总页边距"一个旋钮；四条常驻滑杆会让
 * 排版栏从 2 行涨到 6 行。展开它是"我要单独调某一边"这一小撮需求的一次显式动作。
 *
 * ## 2026-10-22：入口从"页边距那一行"搬出来，四条支路装进一张卡片
 *
 * 原来入口是页边距行末的一颗图标按钮。那一行在窄窗口里本来就贴着左右边缘，再多 30px
 * 按钮之后，尾部（读数 + 来源胶囊）被压成 0 宽、胶囊溢出到按钮底下——用户看到的正是
 * 「随模板」被「分边调整页边距」的按钮压住。行内负空间没法靠调宽度解决：窗口再窄一点，
 * 换一个控件还会再犯一次。所以入口独立成一行折叠标题，行内不再和别的元素抢宽度。
 *
 * 收起态 = 一行「分边调整页边距 ⌄」；展开后是一张卡片：
 * - 四条支路**不再**各带一个「随模板」胶囊（四行一样的胶囊是纯噪声）：没单独调整的边
 *   由卡片底部那行说明交代，只有已单独调整的边才出现 ↺（点它 = 这一边回到统一值）；
 * - 读数列定宽、右对齐、等宽数字，四行的 `14mm` 落在同一条竖线上；
 * - 行首标签仍可双击 / 回车复位（键盘可达，与总滑杆同一套手势）。
 *
 * 两处**必须**由本组件自己负责，不能交给父组件：
 * 1. **探针 CSS**：拖动中要立刻把"这一刻的四边"注入预览。父组件拿不到"手指此刻在哪"，
 *    只有这里知道"第 N 行正在拖、值是 M"。
 * 2. **防抖**：一次拖动会产生几十个事件，每个都发一次 render 请求既慢又会互相覆盖。
 */
import { DownOutlined, MinusOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../i18n";
import type { PageMargins } from "../../utils/pageMargins";
import {
  MARGIN_SIDES,
  MAX_PAGE_MARGIN,
  MIN_PAGE_MARGIN,
  PAGE_MARGIN_STEP,
  clampPageMargin,
} from "../../utils/pageMargins";
import type { MarginSide } from "../../utils/pageMargins";
import { pageMarginsProbeCss } from "../../utils/resumeFormatProbe";

/**
 * 提交防抖（毫秒）。
 *
 * 与 `PagePaddingControl` / `LineHeightControl` 同值：一次提交就要后端重渲染一次，
 * 120ms 足以把一次拖动折叠成一次请求，又短到松手后几乎立刻看到结果。
 */
const COMMIT_DEBOUNCE_MS = 120;

/** 方向 → 行首简称的文案 key（顺序与 `MARGIN_SIDES` 一致）。 */
const SIDE_LABEL_KEY = {
  top: "resume.pageMargin.top",
  right: "resume.pageMargin.right",
  bottom: "resume.pageMargin.bottom",
  left: "resume.pageMargin.left",
} as const;

/** 拖动中的即时值：只可能有一个方向在拖（滑杆不支持多点同时拖同一行）。 */
interface Dragging {
  side: MarginSide;
  value: number;
}

interface Props {
  /** 面板是否展开（收起时只留折叠标题，不渲染四条支路）。 */
  open: boolean;
  onToggle: () => void;
  /** 当前生效的四边（已解析：支路 > 总 > 模板默认）。 */
  margins: PageMargins;
  /** 哪些方向写了自己的键：决定逐行 ↺ 出不出现。 */
  customizedSides?: Record<MarginSide, boolean>;
  disabled?: boolean;
  /** 某个方向被拖到新值（mm）。 */
  onChangeSide: (side: MarginSide, value: number) => void;
  /** 某个方向复位（回到"总"值）。 */
  onResetSide: (side: MarginSide) => void;
  /** 拖动中的即时反馈：与后端 `page_padding_rule` 逐字一致的 CSS。空串 = 清掉探针。 */
  onProbe?: (css: string) => void;
}

/** 复制一份四边并换掉其中一个方向（不改传入对象）。 */
function withSide(margins: PageMargins, side: MarginSide, value: number): PageMargins {
  const next: PageMargins = {
    top: margins.top,
    right: margins.right,
    bottom: margins.bottom,
    left: margins.left,
  };
  next[side] = value;
  return next;
}

export default function PageMarginSidesControl({
  open,
  onToggle,
  margins,
  customizedSides,
  disabled = false,
  onChangeSide,
  onResetSide,
  onProbe,
}: Props) {
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 折叠标题与面板的关联（读屏用）；`useId` 保证同一页出现两次也不会撞。
  const panelId = useId();

  // 父组件确认了新的四边（提交成功或外部改动）之后交回权威值：
  // 否则滑块会停在"手指最后一次经过的位置"，而纸面已经按另一个值排好了。
  const signature = `${margins.top}:${margins.right}:${margins.bottom}:${margins.left}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDragging(null);
  }

  // 关掉 / 收起时清掉未触发的提交，避免对已卸载的父组件调用 onChange。
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const commit = (side: MarginSide, next: number) => {
    const rounded = clampPageMargin(next);
    setDragging({ side, value: rounded });
    // 即时反馈先于提交（项 6 / D10）：探针与最终渲染必须是同一条规则的同一种数字格式。
    // 四边相等时 `pageMarginsProbeCss` 会回落到单值形态，所以"四个 14"松手后不会跳一下。
    onProbe?.(pageMarginsProbeCss(withSide(margins, side, rounded)));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChangeSide(side, rounded);
    }, COMMIT_DEBOUNCE_MS);
  };

  /**
   * 折叠 / 展开。
   *
   * 收起时先把"还没触发的那次提交"和拖动中的值清掉：面板只是隐藏、组件仍然挂着，
   * 但"看不见的控件还在改版式"不是用户能理解的。清在这里而不是 effect 里，
   * 是因为它只由这一个动作引起（unmount 的兜底在下面那个 effect）。
   */
  const toggle = () => {
    if (open) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setDragging(null);
    }
    onToggle();
  };

  const reset = (side: MarginSide) => {
    // 这条边本来就没有自己的值 → 复位是空操作，不该产生一次"看起来没变"的请求。
    if (!customizedSides?.[side]) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDragging(null);
    onProbe?.("");
    // 复位 = 删该边的键（回到"总"值），不是写回一个和默认相等的值：
    // 否则以后模板/总滑杆改动时，这条被"焊死"的边不会跟着变。
    onResetSide(side);
  };

  return (
    // `resume-margin-sides` 在栅格里横跨整行（见 modules.css）：折叠标题与卡片都按整宽排，
    // 四条支路才有足够长度，也不与上面两行两列的度量控件抢格子。
    <div className="resume-margin-sides">
      {/* 折叠标题：**可见的文字**而不是"图标 + Tooltip"。原先那颗图标按钮既占地方
          （把同行的胶囊挤到它底下），又只能靠悬停才知道是什么——一行 12px 的文字
          两个问题一起解决。 */}
      <Button
        type="text"
        size="small"
        className="resume-margin-sides-toggle"
        // 显式的可访问名：箭头图标（`role="img"`）会参与名字计算，
        // 不写就成了「分边调整页边距 down」。
        aria-label={t("resume.pagePadding.sidesToggle")}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={toggle}
      >
        {t("resume.pagePadding.sidesToggle")}
        <DownOutlined className={`resume-margin-sides-chevron${open ? " is-open" : ""}`} />
      </Button>
      {open ? (
        <div
          className="resume-margin-sides-panel"
          id={panelId}
          role="group"
          aria-label={t("resume.pageMargin.sidesTitle")}
        >
          <div className="resume-margin-sides-list">
            {MARGIN_SIDES.map((side) => {
              const shown = clampPageMargin(
                dragging?.side === side ? dragging.value : margins[side],
              );
              const sideLabel = t(SIDE_LABEL_KEY[side]);
              const customized = Boolean(customizedSides?.[side]);
              return (
                // 每行复用其它度量控件的语言（标签 + ± + 滑杆 + 读数），但**不要**它们的
                // 换行行为：一条边永远是一行，滑杆自己吃掉剩余宽度。
                <div key={side} className="resume-margin-side-row">
                  <Tooltip title={t("resume.pageMargin.resetTooltip", { side: sideLabel })}>
                    <span
                      className="resume-measure-label resume-margin-side-label"
                      role="button"
                      tabIndex={0}
                      aria-label={t("resume.pageMargin.resetLabel", { side: sideLabel })}
                      onDoubleClick={() => reset(side)}
                      onKeyDown={(event) => {
                        // 只接管 Enter / 空格：其它按键必须留给滑杆的既有键盘行为。
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        reset(side);
                      }}
                    >
                      {sideLabel}
                    </span>
                  </Tooltip>
                  <Space size={2} align="center" className="resume-margin-side-controls">
                    <Button
                      size="small"
                      type="text"
                      icon={<MinusOutlined />}
                      aria-label={t("resume.pageMargin.decrease", { side: sideLabel })}
                      disabled={disabled || shown <= MIN_PAGE_MARGIN}
                      onClick={() => commit(side, shown - PAGE_MARGIN_STEP)}
                    />
                    <Slider
                      className="resume-margin-side-slider"
                      min={MIN_PAGE_MARGIN}
                      max={MAX_PAGE_MARGIN}
                      step={PAGE_MARGIN_STEP}
                      value={shown}
                      disabled={disabled}
                      aria-label={t("resume.pageMargin.sliderLabel", { side: sideLabel })}
                      ariaLabelForHandle={t("resume.pageMargin.sliderLabel", { side: sideLabel })}
                      tooltip={{
                        formatter: (value) =>
                          value == null ? "" : `${Number(value.toFixed(1))}mm`,
                      }}
                      onChange={(value) => commit(side, value)}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined />}
                      aria-label={t("resume.pageMargin.increase", { side: sideLabel })}
                      disabled={disabled || shown >= MAX_PAGE_MARGIN}
                      onClick={() => commit(side, shown + PAGE_MARGIN_STEP)}
                    />
                  </Space>
                  <Typography.Text type="secondary" className="resume-margin-side-value">
                    {Number(shown.toFixed(1))}mm
                  </Typography.Text>
                  {/* 只有"这一边自己写过键"才出现 ↺：没出现就是跟随统一值，
                    这一列始终占位，四行滑杆因此一样长、读数一样齐。 */}
                  <span className="resume-margin-side-reset">
                    {customized ? (
                      <Tooltip title={t("resume.pageMargin.resetAction", { side: sideLabel })}>
                        <Button
                          size="small"
                          type="text"
                          icon={<UndoOutlined />}
                          aria-label={t("resume.pageMargin.resetAction", { side: sideLabel })}
                          disabled={disabled}
                          onClick={() => reset(side)}
                        />
                      </Tooltip>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          {/* 一句话交代"没出现 ↺ 的边"是什么语义。原先靠每行一个「随模板」胶囊，
              四行一样的胶囊读起来只是噪声。 */}
          <span className="resume-margin-sides-note">{t("resume.pageMargin.sidesNote")}</span>
        </div>
      ) : null}
    </div>
  );
}
