/** 简历版式控制：样式模板 / 格式模板 / 最大篇幅（页数）/ 字号 / 行距，生成与预览弹窗共用。 */

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  MinusOutlined,
  PictureOutlined,
  PlusOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Popover, Segmented, Select, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../hooks/useApi";
import { fetchResumeTemplates } from "../api/resumes";
import { RESUME_PAGE_LIMITS, type ResumeLayout } from "../types";
import type { ResumePreviewHandle } from "./ResumePreview";
import TemplateGalleryModal from "./resume/TemplateGalleryModal";
import LineHeightControl from "./resume/LineHeightControl";
import {
  buildSectionOrderConfig,
  DEFAULT_RESUME_SECTION_ORDER,
  moveSection,
  normalizeSectionOrder,
  RESUME_SECTION_LABELS,
} from "../utils/resumeSectionOrder";
import {
  fontProbeCss,
  fontPxBounds,
  fontTiers,
  layoutForFontPx,
  layoutToFontPx,
  SMALL_FONT_WARNING_PX,
  tierByName,
  withFontAdjust,
} from "../utils/resumeFontScale";

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

interface Props {
  layout: ResumeLayout;
  disabled?: boolean;
  onChange: (layout: ResumeLayout) => void;
  /** 紧凑模式：只留控件、不显示分组标签（放在工具栏里时用）。 */
  compact?: boolean;
  /** 用哪份简历做模板预览；为空时后端用内置示例内容。 */
  resumeId?: number;
  /**
   * 预览句柄：拖动字号时用它把探针 CSS 即时注入预览（本地缩放，无网络往返）。
   * 没有预览时（生成前的配置阶段）可省略——滑块仍可用，只是没有即时反馈。
   */
  previewRef?: React.RefObject<ResumePreviewHandle | null>;
  /**
   * 默认板块顺序是否跟随「我的资料」。
   *
   * 只在**生成**场景为 true：新简历的默认顺序应当等于用户在资料页排好的顺序。
   * 已保存简历（预览 / 编辑）与生成后的预览阶段都不传——它们读的是这份简历自己的
   * `section_order`，没有则用内置默认。否则用户在资料页拖一下，所有老简历的外观都会
   * 跟着变，而"老简历不追溯改变"是这条功能的前提。
   */
  preferProfileOrder?: boolean;
}

export default function ResumeLayoutControls({
  layout,
  disabled = false,
  onChange,
  compact = false,
  resumeId,
  previewRef,
  preferProfileOrder = false,
}: Props) {
  const { data: catalog } = useApi(fetchResumeTemplates, []);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // 版式下拉是点击触发的：选定后提示就该收掉，而不是等鼠标移开（受控开关）。
  // 注意下拉选项在 portal 里渲染，点击不会冒泡到触发器，所以 onChange 里也要关。
  const [formatTipOpen, setFormatTipOpen] = useState(false);
  const templates = catalog?.templates ?? [];
  const formatPresets = catalog?.format_presets ?? [];

  const tiers = useMemo(() => fontTiers(catalog?.font_scales ?? []), [catalog?.font_scales]);
  const pxBounds = useMemo(() => fontPxBounds(tiers), [tiers]);
  const committedPx = layoutToFontPx(layout, tiers);
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
  const currentTemplate = templates.find((item) => item.name === layout.template);
  const defaultTierLabel = tierByName(tiers, catalog?.defaults.font_scale ?? "standard").label;

  // 正文分区顺序：键与标签由后端下发（改默认值只改一处），归一化在前端做同样的事，
  // 因为控件展示的是"完整排列"，而存储里可能只有用户动过的那几项。
  const builtInSectionOrder = useMemo(
    () => catalog?.default_section_order ?? DEFAULT_RESUME_SECTION_ORDER,
    [catalog?.default_section_order],
  );
  // 生效的默认顺序：生成场景跟随资料页，其余场景用内置默认。两个字段刻意分开下发
  // （`profile_section_order` / `default_section_order`），这里按场景选一个。
  const defaultSectionOrder = useMemo(
    () =>
      preferProfileOrder
        ? (catalog?.profile_section_order ?? builtInSectionOrder)
        : builtInSectionOrder,
    [preferProfileOrder, catalog?.profile_section_order, builtInSectionOrder],
  );
  const sectionOptions = useMemo(() => catalog?.section_options ?? [], [catalog?.section_options]);
  const sectionOrder = useMemo(
    () => normalizeSectionOrder(layout.format_config?.section_order, defaultSectionOrder),
    [layout.format_config?.section_order, defaultSectionOrder],
  );
  const isCustomOrder = sectionOrder.join(",") !== defaultSectionOrder.join(",");

  const handleSectionMove = (index: number, direction: -1 | 1) => {
    const next = moveSection(sectionOrder, index, direction);
    if (next === sectionOrder) return;
    onChange({
      ...layout,
      format_config: { ...layout.format_config, section_order: next },
    });
  };

  const handleSectionOrderReset = () => {
    if (!isCustomOrder) return;
    // 「默认」在生成场景下就是资料顺序：写回它，用户才真的回到他看到的那一版；
    // 与内置默认相同时 helper 会把这个键删掉——"没调过"与"调成和默认一样"在存储里
    // 应当是同一种形态。非生成场景传内置默认，因此等于删除这个键（保持原行为）。
    onChange({
      ...layout,
      format_config: buildSectionOrderConfig(
        preferProfileOrder ? defaultSectionOrder : builtInSectionOrder,
        builtInSectionOrder,
        layout.format_config ?? {},
      ),
    });
  };

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
  // 默认值必须取**当前模板**的真实行距：模板之间 1.55~1.8 不等，写死一个数字会让滑块
  // 停在与渲染不同的位置，用户一拖就跳。拖动/防抖/复位那套状态在 LineHeightControl 里。
  const templateLineHeight =
    catalog?.template_layouts?.[layout.template]?.line_height ?? FALLBACK_LINE_HEIGHT;
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

  return (
    <Space size={compact ? 8 : 16} wrap className="resume-layout-controls">
      <Space size={6}>
        {!compact && <Typography.Text type="secondary">样式</Typography.Text>}
        {/* 选模板与看效果合并成同一个入口：打开的就是"每种模板的真实渲染"，
            点「用这个模板」即写入并重渲染（没有额外确认步骤）。这样就不必先在下拉里
            按名字盲选、再另外点一次「看效果」——选与看是同一件事。 */}
        <Tooltip
          title={
            currentTemplate
              ? `${currentTemplate.description}。点击打开预览，直接看到每种模板的真实效果`
              : "打开模板预览，直接看到每种模板的真实效果"
          }
        >
          <Button
            size="small"
            icon={<PictureOutlined />}
            disabled={disabled || templates.length === 0}
            aria-label="选择简历模板并预览效果"
            onClick={() => setGalleryOpen(true)}
          >
            {currentTemplate?.label ?? layout.template}
            {currentTemplate?.custom ? "（自制）" : ""}
          </Button>
        </Tooltip>
      </Space>
      <Space size={6}>
        {!compact && <Typography.Text type="secondary">版式</Typography.Text>}
        <Tooltip
          open={formatTipOpen}
          onOpenChange={setFormatTipOpen}
          title="版式控制行高、页边距与强调色；可以在工作台里自制更多版式"
        >
          <span onClick={() => setFormatTipOpen(false)}>
            <Select
              size="small"
              value={layout.format_name || ""}
              disabled={disabled}
              style={{ minWidth: 120 }}
              options={[
                { value: "", label: "模板自带" },
                ...formatPresets.map((item) => ({
                  value: item.name,
                  label: item.custom ? `${item.label}（自制）` : item.label,
                  title: item.description,
                })),
              ]}
              onChange={(value) => {
                setFormatTipOpen(false);
                onChange({ ...layout, format_name: value });
              }}
            />
          </span>
        </Tooltip>
      </Space>
      <TemplateGalleryModal
        open={galleryOpen}
        layout={layout}
        resumeId={resumeId}
        onSelect={(template) => onChange({ ...layout, template })}
        onClose={() => setGalleryOpen(false)}
      />
      <Space size={6}>
        {!compact && <Typography.Text type="secondary">板块</Typography.Text>}
        <Popover
          trigger="click"
          placement="bottomRight"
          arrow={false}
          title={
            <span className="resume-section-order-title">
              调整板块顺序
              {isCustomOrder && (
                <Button size="small" type="link" onClick={handleSectionOrderReset}>
                  恢复默认
                </Button>
              )}
            </span>
          }
          content={
            <div className="resume-section-order-list" role="list" aria-label="简历板块顺序">
              {sectionOrder.map((key, index) => {
                const label =
                  sectionOptions.find((item) => item.key === key)?.label ??
                  RESUME_SECTION_LABELS[key] ??
                  key;
                return (
                  <div className="resume-section-order-row" role="listitem" key={key}>
                    <span className="resume-section-order-index">{index + 1}</span>
                    <span className="resume-section-order-label">{label}</span>
                    <Space size={0}>
                      <Tooltip title="上移">
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowUpOutlined />}
                          aria-label={`把${label}上移`}
                          disabled={index === 0}
                          onClick={() => handleSectionMove(index, -1)}
                        />
                      </Tooltip>
                      <Tooltip title="下移">
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowDownOutlined />}
                          aria-label={`把${label}下移`}
                          disabled={index === sectionOrder.length - 1}
                          onClick={() => handleSectionMove(index, 1)}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                );
              })}
              <Typography.Paragraph type="secondary" className="resume-section-order-hint">
                顺序对预览、PDF、Word
                与文本导出同时生效；页眉（姓名、求职意向、联系方式）固定在最前。
              </Typography.Paragraph>
            </div>
          }
        >
          <Tooltip title="调整个人总结、教育经历、项目经历等板块在简历里的先后顺序">
            <Button size="small" disabled={disabled} aria-label="调整简历板块顺序">
              顺序{isCustomOrder ? "·已调整" : ""}
            </Button>
          </Tooltip>
        </Popover>
      </Space>
      <Space size={6}>
        {!compact && <Typography.Text type="secondary">最大篇幅</Typography.Text>}
        <Tooltip title="简历内容最多排几页 A4；内容少时会自然留白，不会硬撑满">
          <Segmented
            size="small"
            value={layout.page_limit}
            disabled={disabled}
            options={RESUME_PAGE_LIMITS.map((value) => ({
              value,
              label: `${value} 页`,
            }))}
            onChange={(value) => onChange({ ...layout, page_limit: value as number })}
          />
        </Tooltip>
      </Space>
      <Space size={6}>
        {!compact && <Typography.Text type="secondary">字号</Typography.Text>}
        {/* 无级滑块：拖动时本地即时缩放预览，静置 180ms 后才提交一次。落库仍是
            "档位 + 系数"，所以老简历读到的默认值（系数缺省 1.0）完全不受影响。
            步长 0.1px 是为了让"8px 还是 7.9px 能压进一页"这种判断题有足够的颗粒度；
            两端各配一个 ±0.1px 的按钮，因为滑块在触屏上很难精确落到某一格。 */}
        <Space size={2} align="center">
          <Tooltip title="缩小字号（-0.1px）">
            <Button
              size="small"
              type="text"
              icon={<MinusOutlined />}
              aria-label="缩小字号"
              disabled={disabled || shownPx <= pxBounds.min}
              onClick={() => stepFontPx(-0.1)}
            />
          </Tooltip>
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
            style={{ width: 150, margin: "0 2px" }}
            onChange={handleFontChange}
          />
          <Tooltip title="放大字号（+0.1px）">
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              aria-label="放大字号"
              disabled={disabled || shownPx >= pxBounds.max}
              onClick={() => stepFontPx(0.1)}
            />
          </Tooltip>
        </Space>
        <Typography.Text type="secondary" style={{ minWidth: 44, display: "inline-block" }}>
          {shownPxText}
        </Typography.Text>
        {/* 提示而不是禁用：字号偏小是用户自己的判断题（偶尔确实要压进一页），
            我们的责任是把"打印出来可能看不清"这件事说在动手之前。 */}
        {shownPx < SMALL_FONT_WARNING_PX && (
          <Typography.Text type="warning" className="resume-font-warning">
            小于 {SMALL_FONT_WARNING_PX}px 打印可能看不清
          </Typography.Text>
        )}
        <Tooltip title={`恢复默认字号（${defaultTierLabel}）`}>
          <Button
            size="small"
            type="text"
            icon={<UndoOutlined />}
            disabled={disabled}
            aria-label="恢复默认字号"
            onClick={resetFont}
          />
        </Tooltip>
      </Space>
      <LineHeightControl
        value={configuredLineHeight ?? templateLineHeight}
        customized={configuredLineHeight !== null}
        disabled={disabled}
        compact={compact}
        onChange={applyLineHeight}
      />
    </Space>
  );
}
