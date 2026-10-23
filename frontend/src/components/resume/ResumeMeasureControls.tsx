// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式控件 · 第二组：**度量类**（行距 / 页边距 / 分边 / 字号 / 字体 / 照片）。
 *
 * 从 `ResumeLayoutControls` 拆出（P2 / D4）。这一组是"同一类操作"——连续微调，直到
 * "看着合适"（D5）：字号走无级滑块 + 本地探针，行距/页边距走滑块 + 防抖提交。
 * 字体（项 14）是这一组里唯一"一次选定"的项，所以它没有探针、也没有防抖。
 *
 * 三条必须留在本组内部的东西：
 * 1. **`layoutRef` 与写它的 `useEffect`**：防抖回调在松手之后才跑，这期间父组件可能已经
 *    改了其它版式（页数、模板），提交时必须读"提交那一刻"的 layout，否则会把那些
 *    改动覆盖回去。字号那一格的控件搬去了 `FontSizeControl`，但它提交时仍走这里的
 *    `readLayout`——语义只有和防抖提交同处一地才成立。
 * 2. 行距/页边距的"删键即随模板"语义：`null` = 删掉覆盖，不是写回模板默认值。
 * 3. `showMarginSides` 的默认值（false）：分边页边距**只在简历制作台**里出现
 *    （2026-10-23）。两个既有宿主（生成配置页、主预览）不改一行就自动隐藏。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import FontSizeControl from "./FontSizeControl";
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
  fontPxBounds,
  fontTiers,
  layoutForFontPx,
  layoutToFontPx,
  withFontAdjust,
} from "../../utils/resumeFontScale";

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
  /**
   * 是否渲染「分边页边距」控件。默认 **false**。
   *
   * 分边只在简历制作台（三栏弹窗）里出现：那一栏有专门的纵向空间，四条支路摊开不挤。
   * 生成配置页与主预览的排版栏是"一行全都要"的紧凑形态，多一行折叠标题会把它顶宽
   * （2026-10-22 用户截图：来源胶囊被它压住）。默认 false 让两个既有宿主零改动即隐藏。
   */
  showMarginSides?: boolean;
  /** 分边控件初始是否展开。默认 false（历史行为）；制作台传 true。 */
  defaultSidesOpen?: boolean;
  /**
   * 是否渲染「照片大小」滑杆。默认 **true**。
   *
   * 主预览的排版栏只保留"改动频繁、且能立刻在纸面上看出差别"的几项；照片大小是低频
   * 调整，放在简历制作台左栏（有专门的一组）更合适。2026-10-23 用户口径："预览简历界面
   * 只展示部分功能就可以了"。默认 true 让生成配置页零改动地保留它。
   */
  showPhotoScale?: boolean;
  onChange: (layout: ResumeLayout) => void;
}

export default function ResumeMeasureControls({
  layout,
  disabled = false,
  compact = false,
  catalog,
  previewRef,
  hasPhoto,
  showMarginSides = false,
  defaultSidesOpen = false,
  showPhotoScale = true,
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
  // 防抖回调在最后一次拖动之后才跑；用 ref 读"提交那一刻"的 layout，避免这段时间里
  // 父组件改了其它版式（如页数）时被本次提交用旧 layout 覆盖回去。
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）：防抖回调在提交之后才执行。
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  /** 字号：档位 + 系数一起进签名，任一变化都让滑块回到权威值。 */
  const fontSignature = `${layout.font_scale}:${layout.format_config?.["font_scale_adjust"] ?? ""}`;
  /** 用户是否调过字号（档位不是默认值，或写了系数覆盖）。 */
  const fontCustomized =
    (layout.font_scale ?? catalog?.defaults.font_scale ?? "standard") !==
      (catalog?.defaults.font_scale ?? "standard") ||
    (layout.format_config?.font_scale_adjust ?? 1) !== 1;

  /** 防抖到点后的字号提交：读"提交那一刻"的 layout，只改字号。 */
  const commitFontPx = (px: number) => {
    onChange(layoutForFontPx(layoutRef.current, px, tiers));
  };

  /** 恢复默认：回到默认档位，并清掉系数覆盖（保留强调色等其它覆盖）。 */
  const resetFont = () => {
    onChange({
      ...layoutRef.current,
      font_scale: catalog?.defaults.font_scale ?? "standard",
      format_config: withFontAdjust(layoutRef.current.format_config, 1),
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
  // 分边面板的展开状态住在这里（控件本身不管"该不该出现"）。
  const [sidesOpen, setSidesOpen] = useState(defaultSidesOpen);
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
          "压不压得进一页"的旋钮，排在第一行；字号与字体在第二行（用户 2026-10-20 指定）。
          分边页边距紧跟在它的总滑杆之后（2026-10-23）：它解释的是"页边距"这一项，
          隔开放到末尾会让人读不出两者的从属关系。 */}
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
      {/* 分边页边距：只在制作台里渲染（见 `showMarginSides`）。折叠标题常驻、
          面板默认收起、展开后占满整行（`.resume-margin-sides` 的 grid-column）。
          四条支路各自独立拖动/防抖，写入语义统一在 `utils/pageMargins.ts`。 */}
      {showMarginSides ? (
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
      ) : null}
      <FontSizeControl
        value={committedPx}
        bounds={pxBounds}
        signature={fontSignature}
        customized={fontCustomized}
        disabled={disabled}
        compact={compact}
        previewRef={previewRef}
        onCommit={commitFontPx}
        onReset={resetFont}
      />
      <div className="resume-measure-cell">
        <span className="resume-measure-label">{t("resume.measure.fontLabel")}</span>
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
          排在「字体」之后，与上面三行共用同一套"标签 + ± + 滑杆 + 读数"的视觉语言。
          主预览不渲染它（`showPhotoScale={false}`）：那一栏只留高频项，照片大小去制作台调。 */}
      {showPhotoScale ? (
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
      ) : null}
    </div>
  );
}
