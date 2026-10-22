// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式控件 · 第二组：**度量类**（字号 / 行距 / 页边距 / 字体）。
 *
 * 从 `ResumeLayoutControls` 拆出（P2 / D4）。这一组是"同一类操作"——连续微调，直到
 * "看着合适"（D5）：字号走无级滑块 + 本地探针，行距/页边距走滑块 + 防抖提交。
 * 字体（项 14）是这一组里唯一"一次选定"的项，所以它没有探针、也没有防抖。
 *
 * 三条必须留在本组内部的东西：
 * 1. **`layoutRef` 与写它的 `useEffect`**：防抖回调在松手之后才跑，这期间父组件可能已经
 *    改了其它版式（页数、模板），提交时必须读"提交那一刻"的 layout，否则会把那些
 *    改动覆盖回去。这个语义只有和防抖提交同处一地才成立。
 * 2. 字号那套拖动中状态（`draggingPx` / `debounceRef` / `fontSignature`），
 *    它们描述的是"手指还没松开"的瞬时值，不属于壳也不属于父组件。
 * 3. 行距/页边距的"删键即随模板"语义：`null` = 删掉覆盖，不是写回模板默认值。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import LineHeightControl from "./LineHeightControl";
import PageMarginSidesControl from "./PageMarginSidesControl";
import PagePaddingControl from "./PagePaddingControl";
import PhotoScaleControl from "./PhotoScaleControl";
import ResumeFontControl from "./ResumeFontControl";
import { t } from "../../i18n";
import {
  configuredPhotoScale,
  hasMarginOverrides,
  marginsAreUniform,
  resolvePageMargins,
  resolvePhotoScale,
  sidesDifferingFromMaster,
  toPhotoPercent,
  withMarginSide,
  withPhotoScale,
  withResetMarginSide,
  withUniformMargin,
  type MarginSide,
} from "../../utils/pageMargins";
import {
  fontProbeCss,
  fontPxBounds,
  fontTiers,
  layoutForFontPx,
  layoutToFontPx,
  SMALL_FONT_WARNING_PX,
  withFontAdjust,
} from "../../utils/resumeFontScale";

/**
 * 拖动字号后多久提交一次（毫秒）。
 *
 * 连续拖动每秒会产生几十个事件，每个都 PATCH + render 会打出几十个请求；而用户真正
 * 想要的"实时手感"由本地探针即时给到，一次往返完全来得及。取 180ms：短到松手后几乎
 * 立刻看到真实渲染，长到足以把一次连续拖动折叠成**一次**提交（比诊断面板的 250ms 略快，
 * 因为这里用户的手指刚离开、对延迟更敏感）。
 */
const FONT_COMMIT_DEBOUNCE_MS = 180;

/** 模板目录里拿不到默认行距时的兜底（经典模板的默认值，也是历史默认）。 */
const FALLBACK_LINE_HEIGHT = 1.7;

/**
 * 模板目录里拿不到默认页边距时的兜底（经典模板的 14mm）。
 *
 * 目录里**有** `template_layouts[template].padding_mm`（前后端都有），所以这里只是
 * "旧后端/目录未下发"的兜底，不是第二个默认值来源——取值永远以目录为准。
 */
const FALLBACK_PAGE_PADDING = 14;

interface Props {
  layout: ResumeLayout;
  disabled?: boolean;
  /** 紧凑模式：只留控件、不显示分组标签（放在工具栏里时用）。 */
  compact?: boolean;
  /** 模板目录（由壳 `ResumeLayoutControls` 取一次后下发）。 */
  catalog?: ResumeTemplateCatalog;
  /**
   * 预览句柄：拖动字号时用它把探针 CSS 即时注入预览（本地缩放，无网络往返）。
   * 没有预览时（生成前的配置阶段）可省略——滑块仍可用，只是没有即时反馈。
   */
  previewRef?: RefObject<ResumePreviewHandle | null>;
  /**
   * 这份简历有没有照片（由持有内容的宿主透传）。
   *
   * `false` → 照片滑杆禁用并说明「未上传照片」：`photo_scale` 在没有照片时完全惰性
   * （PDF/Word 连页头空间都不预留），让用户拖一个"什么都没发生"的滑杆是最差的反馈。
   * `undefined` → 不禁用（生成前的配置阶段拿不到内容），只是没有即时预览。
   */
  hasPhoto?: boolean;
  onChange: (layout: ResumeLayout) => void;
}

export default function ResumeMeasureControls({
  layout,
  disabled = false,
  compact = false,
  catalog,
  previewRef,
  hasPhoto,
  onChange,
}: Props) {
  const tiers = useMemo(() => fontTiers(catalog?.font_scales ?? []), [catalog?.font_scales]);
  const pxBounds = useMemo(() => fontPxBounds(tiers), [tiers]);
  // 当前「版式」预设的配置：换版式时它盖掉模板默认（模板 < 版式 < 手动微调）。
  const presetConfig = catalog?.format_presets?.find(
    (item) => item.name === layout.format_name,
  )?.config;
  const presetFontAdjust =
    typeof presetConfig?.font_scale_adjust === "number" ? presetConfig.font_scale_adjust : null;
  // 用户自己拖过字号（format_config 里有系数）时以用户为准；否则跟着预设走。
  const fontLayout =
    presetFontAdjust !== null && layout.format_config?.["font_scale_adjust"] === undefined
      ? {
          ...layout,
          format_config: { ...layout.format_config, font_scale_adjust: presetFontAdjust },
        }
      : layout;
  const committedPx = layoutToFontPx(fontLayout, tiers);
  // 拖动过程中的即时值：非 null 时覆盖 committedPx，让滑块与读数跟着手指走。
  const [draggingPx, setDraggingPx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 防抖回调在最后一次拖动之后才跑；用 ref 读"提交那一刻"的 layout，避免这段时间里
  // 父组件改了其它版式（如页数）时被本次字号提交用旧 layout 覆盖回去。
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）：防抖回调在提交之后才执行。
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  // 布局一被父组件确认（提交成功或外部改动），就交回权威值，避免滑块停在中间态。
  // 字号签名一变（提交成功或外部改动），交回权威值并清掉拖动中的即时值。
  // 用标量签名而不是 layout 对象：父组件每次渲染都新建对象，直接依赖它会不停误触发。
  const fontSignature = `${layout.font_scale}:${layout.format_config?.["font_scale_adjust"] ?? ""}`;
  const [prevFontSignature, setPrevFontSignature] = useState(fontSignature);
  if (prevFontSignature !== fontSignature) {
    setPrevFontSignature(fontSignature);
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
  // 可用性说的是同一件事；真正落库时仍由 layoutForFontPx 做 2 位精度换算，不丢精度。
  const shownPx = Math.round((draggingPx ?? committedPx) * 10) / 10;
  const shownPxText = `${Number(shownPx.toFixed(1))}px`;

  const handleFontChange = (px: number) => {
    // 0.1px 步长下浮点尾巴会直接漏到读数与落库值里（14.100000000000001），所以入口
    // 先统一规整到一位小数：`setDraggingPx`、探针 CSS 与提交用的必须是**同一个**值，
    // 否则"看到的"和"存下的"会差那么一点点，回填时读数还会跳一下。
    const nextPx = Math.round(px * 10) / 10;
    setDraggingPx(nextPx);
    // 即时反馈：直接改预览里的 `--fs`，不外发请求。探针保持到下一次重渲染（iframe 重新
    // 加载时自然销毁），所以从"拖动中的字号"到"最终渲染的字号"之间不会出现跳回旧值的闪动。
    previewRef?.current?.setLiveProbe(fontProbeCss(nextPx));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChange(layoutForFontPx(layoutRef.current, nextPx, tiers));
    }, FONT_COMMIT_DEBOUNCE_MS);
  };

  /** 夹进滑块范围：两端步进按钮与滑块必须共用同一套边界，否则会点出越界值。 */
  const clampToBounds = (px: number): number => Math.min(pxBounds.max, Math.max(pxBounds.min, px));
  /**
   * 两端加减按钮各走 0.1px。
   *
   * 滑块的 0.1px 步长在触屏/触控板上很难精确命中一格（手指一动就是两三格），
   * 按钮给的是"确定地只挪一格"的入口；推进量先按一位小数取整再夹边界，
   * 所以连点也不会累积出 18.000000000000004 这种值。
   */
  const stepFontPx = (delta: number) => {
    handleFontChange(clampToBounds(Math.round((shownPx + delta) * 10) / 10));
  };

  const resetFont = () => {
    // 已经是默认档位 + 无系数覆盖：双击标题不该产生一次"看起来没变"的提交。
    if (
      (layout.font_scale ?? catalog?.defaults.font_scale ?? "standard") ===
        (catalog?.defaults.font_scale ?? "standard") &&
      (layout.format_config?.font_scale_adjust ?? 1) === 1
    ) {
      return;
    }
    // 恢复默认：回到默认档位，并清掉系数覆盖（保留强调色等其它覆盖）。
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    previewRef?.current?.setLiveProbe("");
    setDraggingPx(null);
    onChange({
      ...layout,
      font_scale: catalog?.defaults.font_scale ?? "standard",
      format_config: withFontAdjust(layout.format_config, 1),
    });
  };

  // ===== 行距（R20）=====
  // 默认值取**当前生效的版式**：模板之间 1.55~1.8 不等，写死一个数字会让滑块停在与
  // 渲染不同的位置，用户一拖就跳。版式预设（紧凑 1.45 / 舒展 2.0）优先于模板默认——
  // 否则选了「紧凑」，滑杆还停在模板的 1.70，看起来像没生效。
  // 拖动/防抖/复位那套状态在 LineHeightControl 里。
  // `format_config` 的值可能是字符串（比如强调色），只认数字。
  const presetLineHeight =
    typeof presetConfig?.line_height === "number" ? presetConfig.line_height : null;
  const presetPagePadding =
    typeof presetConfig?.page_padding === "number" ? presetConfig.page_padding : null;
  const templateLineHeight =
    presetLineHeight ??
    catalog?.template_layouts?.[layout.template]?.line_height ??
    FALLBACK_LINE_HEIGHT;
  const configuredLineHeight =
    typeof layout.format_config?.line_height === "number" ? layout.format_config.line_height : null;

  /**
   * 写行距：数值 = 写入覆盖；null = 删掉覆盖（回到随模板）。
   *
   * 用 `layoutRef.current` 而不是闭包里的 `layout`：防抖回调在松手 120ms 后才跑，
   * 这期间父组件可能已经改了页数或字号，用旧快照会把那些改动覆盖回去。
   */
  const applyLineHeight = (next: number | null) => {
    const current = layoutRef.current;
    if (next === null) {
      // 删键而不是写回模板默认值：存储里"没调过"与"调成和默认一样"应当是同一形态，
      // 否则以后模板更新默认行距时，这些简历不会跟着变。
      const rest = { ...(current.format_config ?? {}) };
      delete rest["line_height"];
      onChange({ ...current, format_config: rest });
      return;
    }
    onChange({
      ...current,
      format_config: { ...current.format_config, line_height: next },
    });
  };

  // ===== 页边距（T5 / 项 4a）：落点仍是 format_config =====
  // 默认值取**当前模板**的 `padding_mm`（目录下发，classic=14 / compact=12），
  // 与行距同理：写死会让滑块停在与渲染不同的位置。
  const templatePagePadding =
    presetPagePadding ??
    catalog?.template_layouts?.[layout.template]?.padding_mm ??
    FALLBACK_PAGE_PADDING;
  // 「总」滑杆 + 四条支路的唯一解析口径（与后端 `resolve_page_margins` 同序）：
  // 支路 > 总 > 模板默认。四边不等时总滑杆读数显示「自定义」，拖动它则把四边重新拉平。
  const margins = resolvePageMargins(layout.format_config, templatePagePadding);
  const marginsUniform = marginsAreUniform(margins);
  const marginsCustomized = hasMarginOverrides(layout.format_config);
  // 分边控件默认收起：四条常驻滑杆会让排版栏从 2 行涨到 6 行（设计 §9 第 4 条）。
  const [sidesOpen, setSidesOpen] = useState(false);
  // 逐行 ↺ 只看"这一边和统一值是否不同"：拖一条边会把四条键一起写全，
  // 用"写过没有"判断会让四行同时长出复位图标（详见 `sidesDifferingFromMaster`）。
  const customizedSides = sidesDifferingFromMaster(layout.format_config, templatePagePadding);

  const configuredPhotoPercent = configuredPhotoScale(layout.format_config);
  const photoPercent = toPhotoPercent(resolvePhotoScale(layout.format_config));

  /**
   * 拖动中的即时反馈通道（项 6）：控件把"与后端 `css_rule` 逐字一致"的 CSS 交出来，
   * 这里注入预览 iframe。没有预览（生成前的配置阶段）时 `previewRef` 为空，
   * 整条链路静默降级——不报错，只是没有即时预览。
   */
  const applyProbe = (css: string) => {
    previewRef?.current?.setLiveProbe(css);
  };

  /**
   * 总滑杆：写 `page_padding` 并**删掉四条支路**（四边一起变）；`null` = 回到随模板。
   *
   * 用 `layoutRef.current` 而不是闭包里的 `layout`：防抖回调在松手 120ms 后才跑，
   * 这期间父组件可能已经改了页数或字号，用旧快照会把那些改动覆盖回去。
   */
  const applyPagePadding = (next: number | null) => {
    const current = layoutRef.current;
    onChange({
      ...current,
      format_config: withUniformMargin(current.format_config, next),
    });
  };

  /** 拖某一条边：四条支路写全（其中一条换成新值），四边重新相等时塌回单键。 */
  const applyMarginSide = (side: MarginSide, value: number) => {
    const current = layoutRef.current;
    onChange({
      ...current,
      format_config: withMarginSide(current.format_config, side, value, templatePagePadding),
    });
  };

  /** 单边复位：这一边回到"总"（没有总回到模板默认），其余三边不动。 */
  const resetMarginSide = (side: MarginSide) => {
    const current = layoutRef.current;
    onChange({
      ...current,
      format_config: withResetMarginSide(current.format_config, side, templatePagePadding),
    });
  };

  /** 照片大小：写 `photo_scale`（百分比 → 系数）；回到 100% 即删键（随模板）。 */
  const applyPhotoScale = (percent: number | null) => {
    const current = layoutRef.current;
    onChange({
      ...current,
      format_config: withPhotoScale(current.format_config, percent),
    });
  };

  return (
    <div className={`resume-measure-grid ${compact ? "is-compact" : "is-stacked"}`}>
      {/* 顺序按「先调版式密度、再调字号、最后换字体」：行距与页边距是同一类
          "压不压得进一页"的旋钮，排在第一行；字号与字体在第二行（用户 2026-10-20 指定）。 */}
      <LineHeightControl
        defaultHint={
          presetConfig ? t("resume.measure.hintPreset") : t("resume.measure.hintTemplate")
        }
        value={configuredLineHeight ?? templateLineHeight}
        customized={configuredLineHeight !== null}
        disabled={disabled}
        onProbe={applyProbe}
        onChange={applyLineHeight}
      />
      <PagePaddingControl
        defaultHint={
          presetConfig ? t("resume.measure.hintPreset") : t("resume.measure.hintTemplate")
        }
        value={margins.top}
        customized={marginsCustomized}
        uniform={marginsUniform}
        // 自定义态下读数只写「自定义」：四边各是多少放在悬停气泡里
        // （「上 8 · 右 12 · 下 12 · 左 12」），一处不重复维护。
        margins={margins}
        disabled={disabled}
        onProbe={applyProbe}
        onChange={applyPagePadding}
      />
      <div className="resume-measure-cell">
        {/* 双击标题恢复默认：原来每格末尾还有一颗 ↺，四个控件就多出四个图标，
            既占宽又难瞄。改成双击标题，标题本身就是"这一项的名字"，心智更顺。
            提示走 Tooltip 而不是原生 title：后者只对鼠标可见，键盘/读屏用户拿不到
            "这里可双击"这条唯一可发现性信息（Tooltip 不产生 DOM，层级不变）。
            标签在行首、气泡向上弹，不会盖住同排控件——与下面 ± 按钮"不挂 Tooltip"
            的取舍并不冲突：那条讲的是按钮在滑杆中间、气泡会压住相邻控件。
            单击刻意不重置（误点代价是丢掉手调的字号），键盘侧给的是 Enter / 空格
            （与 `LineHeightControl` / `PagePaddingControl` 同一套交互）。 */}
        <Tooltip title="双击或按回车恢复默认字号">
          <span
            className="resume-measure-label"
            role="button"
            tabIndex={0}
            aria-label="字号（双击或按回车恢复默认）"
            onDoubleClick={resetFont}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              resetFont();
            }}
          >
            字号
          </span>
        </Tooltip>
        {/* 无级滑块：拖动时本地即时缩放预览，静置 180ms 后才提交一次。落库仍是
            "档位 + 系数"，所以老简历读到的默认值（系数缺省 1.0）完全不受影响。
            步长 0.1px 是为了让"8px 还是 7.9px 能压进一页"这种判断题有足够的颗粒度；
            两端各配一个 ±0.1px 的按钮，因为滑块在触屏上很难精确落到某一格。
            ± 按钮不再挂 Tooltip：悬停气泡会盖住相邻控件，而 aria-label 已经说明用途。 */}
        <Space size={2} align="center">
          <Button
            size="small"
            type="text"
            icon={<MinusOutlined />}
            aria-label="缩小字号"
            disabled={disabled || shownPx <= pxBounds.min}
            onClick={() => stepFontPx(-0.1)}
          />
          <Slider
            className="resume-font-slider"
            min={pxBounds.min}
            max={pxBounds.max}
            step={0.1}
            value={shownPx}
            disabled={disabled}
            aria-label="字号（拖动调整，方向键微调）"
            ariaLabelForHandle="字号"
            tooltip={{
              formatter: (value) => (value == null ? "" : `${Number(value.toFixed(1))}px`),
            }}
            // 宽度可收缩：固定 150px 会在栅格里顶穿自己的格子，压到相邻列上。
            // 弹窗模式（`.is-stacked`）里三条滑杆由 CSS 统一写死 200px（见 modules.css），
            // 那份 `width` 与这里的 `flex` 不冲突：外层格子已经定宽，滑块按 width 走。
            style={{ flex: "1 1 90px", minWidth: 70, margin: "0 2px" }}
            onChange={handleFontChange}
          />
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            aria-label="放大字号"
            disabled={disabled || shownPx >= pxBounds.max}
            onClick={() => stepFontPx(0.1)}
          />
        </Space>
        {/* 读数落在与上一行（行距/页边距）同一条竖线上：尾部左对齐 + 定宽读数列（见 modules.css）。 */}
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
            小于 {SMALL_FONT_WARNING_PX}px 打印可能看不清
          </Typography.Text>
        )}
      </div>
      <div className="resume-measure-cell">
        <span className="resume-measure-label">字体</span>
        {/* 字体（项 14）：它写的是**这一份简历**的 `format_config.font`，与「设置 → 应用 →
            简历字体」那个设备级选择是两件事（见 ResumeFontControl 头注释）。
            `alignWithSlider` 只在弹窗里开：上面那一行就是页边距滑杆，
            下拉要与它同宽、同起点，两行才像一组控件。 */}
        <ResumeFontControl
          layout={layout}
          onChange={onChange}
          compact={compact}
          alignWithSlider={!compact}
          disabled={disabled}
        />
      </div>
      {/* 照片大小（系数，不是绝对尺寸）：乘在模板自己的宽高上，宽高比不变。
          排在「字体」之后，与上面三行共用同一套"标签 + ± + 滑杆 + 读数"的视觉语言。 */}
      <PhotoScaleControl
        defaultHint={
          presetConfig ? t("resume.measure.hintPreset") : t("resume.measure.hintTemplate")
        }
        value={photoPercent}
        customized={configuredPhotoPercent !== null}
        disabled={disabled}
        hasPhoto={hasPhoto}
        onProbe={applyProbe}
        onChange={applyPhotoScale}
      />
      {/* 分边页边距：折叠标题常驻、面板默认收起、展开后占满整行
          （`.resume-margin-sides` 的 grid-column）。入口**不在**页边距那一行里：
          那一行在窄窗口放不下第四件东西（2026-10-22 用户截图：来源胶囊被它压住）。
          四条支路各自独立拖动/防抖，写入语义统一在 `utils/pageMargins.ts`。 */}
      <PageMarginSidesControl
        open={sidesOpen}
        onToggle={() => setSidesOpen((open) => !open)}
        margins={margins}
        customizedSides={customizedSides}
        disabled={disabled}
        onChangeSide={applyMarginSide}
        onResetSide={resetMarginSide}
        onProbe={applyProbe}
      />
    </div>
  );
}
