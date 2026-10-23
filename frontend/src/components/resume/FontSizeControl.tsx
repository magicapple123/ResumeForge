// SPDX-License-Identifier: Apache-2.0
/**
 * 字号控件（从 `ResumeMeasureControls` 迁出）：无级滑块 + 两端 ±0.1px + 读数 + 双击恢复。
 *
 * ## 为什么单独成文件
 *
 * `ResumeMeasureControls` 同时装着行距 / 页边距 / 分边 / 字体 / 照片，已经贴到 500 行预算。
 * 字号是其中唯一带"拖动中即时值 + 本地探针 + 180ms 防抖提交"三项状态的项，把它整体搬出来
 * 比在主控件里挤着看更清楚。
 *
 * ## 什么留在父组件
 *
 * `layoutRef` 与写它的 effect **必须**留在 `ResumeMeasureControls`：行距 / 页边距 / 分边 /
 * 照片四个防抖写者共用它（防抖回调在松手之后才跑，提交时必须读"提交那一刻"的 layout，
 * 否则会把这段时间里父组件改的其它版式覆盖回去）。这里只通过 `onCommit` 把"指尖上的
 * 字号"交出去，由父组件用 `readLayout()` 组出下一份 layout。
 *
 * ## 落库形态没变
 *
 * 仍然是"档位 + 系数"（`font_scale` + `format_config.font_scale_adjust`），所以老简历读到
 * 的默认值（系数缺省 1.0）完全不受影响。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumePreviewHandle } from "../ResumePreview";
import { t } from "../../i18n";
import { SMALL_FONT_WARNING_PX, fontProbeCss } from "../../utils/resumeFontScale";

/**
 * 拖动字号后多久提交一次（毫秒）。
 *
 * 连续拖动每秒会产生几十个事件，每个都 PATCH + render 会打出几十个请求；而用户真正
 * 想要的"实时手感"由本地探针即时给到，一次往返完全来得及。取 180ms：短到松手后几乎
 * 立刻看到真实渲染，长到足以把一次连续拖动折叠成**一次**提交（比诊断面板的 250ms 略快，
 * 因为这里用户的手指刚离开、对延迟更敏感）。
 */
const FONT_COMMIT_DEBOUNCE_MS = 180;

/** 滑杆可用区间（px）。由父组件按目录下发的字号档位算出，控件内不重复定义来源。 */
export interface FontPxBounds {
  min: number;
  max: number;
}

interface Props {
  /** 已确认的字号（px）：父组件按"版式预设系数优先"解析后的权威值。 */
  value: number;
  /** 滑杆与两端按钮共用的边界。 */
  bounds: FontPxBounds;
  /**
   * 父组件确认值变化时用的标量签名（`档位:系数`）：一变就丢弃拖动中的即时值。
   *
   * 用标量而不是 layout 对象：父组件每次渲染都新建对象，直接依赖它会不停误触发。
   */
  signature: string;
  /** 用户是否设过覆盖（档位或系数）。没设过时双击标题是空操作。 */
  customized: boolean;
  disabled?: boolean;
  /** 紧凑模式：不显示"字号偏小"那一行提示（工具栏里没地方）。 */
  compact?: boolean;
  /** 预览句柄：拖动时把探针 CSS 即时注入预览（本地缩放，无网络往返）。 */
  previewRef?: RefObject<ResumePreviewHandle | null>;
  /** 防抖到点后交出"最终字号"（0.1px 网格上的一位小数）。 */
  onCommit: (px: number) => void;
  /** 恢复默认（父组件负责删系数覆盖并回到默认档位）。 */
  onReset: () => void;
}

export default function FontSizeControl({
  value,
  bounds,
  signature,
  customized,
  disabled = false,
  compact = false,
  previewRef,
  onCommit,
  onReset,
}: Props) {
  // 拖动过程中的即时值：非 null 时覆盖 value，让滑块与读数跟着手指走。
  const [draggingPx, setDraggingPx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 字号签名一变（提交成功或外部改动），交回权威值并清掉拖动中的即时值。
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDraggingPx(null);
  }

  // 关掉组件时清掉未触发的提交，避免对已卸载的父组件调用 onChange。
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // 滑块的可用界面是 0.1px 网格，所以权威值在这里也先落到同一网格上：后端可能存着
  // 17.98 这种两位小数的系数（映射函数保留 2 位），若原样喂给控件，就会出现"读数写 18px、
  // 但「放大」按钮还亮着"这种自相矛盾的状态。规整到 0.1 后，读数、滑块与两端按钮的
  // 可用性说的是同一件事；真正落库时仍由 `layoutForFontPx` 做 2 位精度换算。
  const shownPx = Math.round((draggingPx ?? value) * 10) / 10;
  const shownPxText = `${Number(shownPx.toFixed(1))}px`;

  const change = (px: number) => {
    // 0.1px 步长下浮点尾巴会直接漏到读数与落库值里（14.100000000000001），所以入口
    // 先统一规整到一位小数：`setDraggingPx`、探针 CSS 与提交用的必须是**同一个**值，
    // 否则"看到的"和"存下的"会差那么一点点，回填时读数还会跳一下。
    const nextPx = Math.round(px * 10) / 10;
    setDraggingPx(nextPx);
    // 即时反馈：直接改预览里的 `--fs`，不外发请求。探针保持到下一次重渲染（iframe 重新
    // 加载时自然销毁），所以从"拖动中的字号"到"最终渲染的字号"之间不会跳回旧值。
    previewRef?.current?.setLiveProbe(fontProbeCss(nextPx));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onCommit(nextPx);
    }, FONT_COMMIT_DEBOUNCE_MS);
  };

  /** 夹进滑块范围：两端步进按钮与滑块必须共用同一套边界，否则会点出越界值。 */
  const clampToBounds = (px: number): number => Math.min(bounds.max, Math.max(bounds.min, px));

  /**
   * 两端加减按钮各走 0.1px。
   *
   * 滑块的 0.1px 步长在触屏/触控板上很难精确命中一格（手指一动就是两三格），
   * 按钮给的是"确定地只挪一格"的入口；推进量先按一位小数取整再夹边界，
   * 所以连点也不会累积出 18.000000000000004 这种值。
   */
  const stepPx = (delta: number) => {
    change(clampToBounds(Math.round((shownPx + delta) * 10) / 10));
  };

  const reset = () => {
    // 已经是默认档位 + 无系数覆盖：双击标题不该产生一次"看起来没变"的提交。
    if (!customized) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    previewRef?.current?.setLiveProbe("");
    setDraggingPx(null);
    onReset();
  };

  // `wrap` 由外层 `.resume-measure-cell` 的 flex 换行负责；这里沿用其它度量控件的
  // "标签（可双击复位）+ ± + 滑杆 + 读数"。
  return (
    <div className="resume-measure-cell">
      {/* 双击标题恢复默认：与 `LineHeightControl` / `PagePaddingControl` 同一套手势
          （单击刻意不重置——误点的代价是丢掉手调的字号）。
          提示走 Tooltip 而不是原生 title：后者只对鼠标可见，键盘/读屏用户拿不到
          "这里可双击"这条唯一可发现性信息（Tooltip 不产生 DOM，层级不变）。 */}
      <Tooltip title={t("resume.measure.fontSizeReset")}>
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label={t("resume.measure.fontSizeResetLabel")}
          onDoubleClick={reset}
          onKeyDown={(event) => {
            // 只接管 Enter / 空格：其它按键必须留给滑块的既有键盘行为。
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          {t("resume.measure.fontSize")}
        </span>
      </Tooltip>
      <Space size={2} align="center">
        <Button
          size="small"
          type="text"
          icon={<MinusOutlined />}
          aria-label={t("resume.measure.fontSizeDecrease")}
          disabled={disabled || shownPx <= bounds.min}
          onClick={() => stepPx(-0.1)}
        />
        <Slider
          className="resume-font-slider"
          min={bounds.min}
          max={bounds.max}
          step={0.1}
          value={shownPx}
          disabled={disabled}
          aria-label={t("resume.measure.fontSizeSliderAria")}
          ariaLabelForHandle={t("resume.measure.fontSize")}
          tooltip={{
            formatter: (value) => (value == null ? "" : `${Number(value.toFixed(1))}px`),
          }}
          // 宽度可收缩：固定 150px 会在栅格里顶穿自己的格子，压到相邻列上。
          // 弹窗模式（`.is-stacked`）里三条滑杆由 CSS 统一写死 200px（见 modules-layout.css），
          // 那份 `width` 与这里的 `flex` 不冲突：外层格子已经定宽，滑块按 width 走。
          style={{ flex: "1 1 90px", minWidth: 70, margin: "0 2px" }}
          onChange={change}
        />
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label={t("resume.measure.fontSizeIncrease")}
          disabled={disabled || shownPx >= bounds.max}
          onClick={() => stepPx(0.1)}
        />
      </Space>
      {/* 读数落在与行距/页边距同一条竖线上：尾部左对齐 + 定宽读数列（见 modules-layout.css）。 */}
      <span className="resume-measure-tail">
        <Typography.Text type="secondary" className="resume-measure-value">
          {shownPxText}
        </Typography.Text>
      </span>
      {/* 提示而不是禁用：字号偏小是用户自己的判断题（偶尔确实要压进一页），
          我们的责任是把"打印出来可能看不清"这件事说在动手之前。
          单独占一整行：挤在读数后面时这一格只剩几十像素，提示会被压成竖排的窄条。 */}
      {!compact && shownPx < SMALL_FONT_WARNING_PX && (
        <Typography.Text type="warning" className="resume-font-warning">
          {t("resume.measure.fontTooSmall", { px: SMALL_FONT_WARNING_PX })}
        </Typography.Text>
      )}
    </div>
  );
}
