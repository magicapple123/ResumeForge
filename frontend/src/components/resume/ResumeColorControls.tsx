// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · **外观**组（简历制作台左栏）：强调色 / 正文颜色 / 辅助文字颜色 / 分隔线颜色。
 *
 * ## 为什么是这四个键
 *
 * 它们就是后端 `FORMAT_FIELDS` 里 `type: "color"` 的四项（`resume_template_format.py:41-44`），
 * 落点 `format_config[<key>]`，由 `format_css` 翻成 `:root { --accent: …; }`。**不新增键**，
 * 所以目录下发什么标签这里就显示什么——`label` 只有一份来源（与「自制版式」编辑器同一份）。
 *
 * ## 取色只有两条路：预设色板与自由取色
 *
 * 色板是 5 个"简历上真能用"的深色（纯黑/深灰/深蓝/墨绿/暗红），一键就落；其余走 antd 的
 * `ColorPicker`。色板值写在模块常量里而不是 CSS：它们是**数据**（用户会把它存进
 * `format_config` 并跟着导出走），不是主题色 token——`docs` 里禁的是"界面自己画颜色"，
 * 不是"把用户选的颜色传下去"。渲染时通过 `--resume-wb-swatch` 这个内联自定义属性交给
 * CSS，避免在 `style={{ background: "#…" }}` 上写死颜色（`inlineColorGuard` 的口径）。
 *
 * ## 恢复默认 = 删键
 *
 * 删掉即回到模板自己的 `:root` 变量，而不是把"模板默认色"抄进 `format_config`：
 * 以后模板换配色时，这些简历才跟着变。
 */
import { ColorPicker, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import { t, type MessageKey } from "../../i18n";
import { colorProbeCss } from "../../utils/resumeFormatProbe";
import { formatFieldLabelOf } from "../../utils/resumeFormatLabels";
import { formatKeysDiffer, restoreFormatKeys } from "../../utils/paramRestore";
import ParamResetButton from "./ParamResetButton";
import { useLocale } from "../../i18n/i18nContext";

/** 四个颜色键（顺序即左栏里的行序，与目录 `FORMAT_FIELDS` 同序）。 */
const COLOR_KEYS = ["accent", "text_color", "muted_color", "line_color"] as const;

type ColorKey = (typeof COLOR_KEYS)[number];

/**
 * 预设色板：5 个深色。
 *
 * 只给深色：简历是要打印的——浅色在纸上几乎看不见，放在色板里等于诱导用户排出一份
 * 打不出来的简历。要浅色仍可自由取色。
 */
const PALETTE: readonly { labelKey: MessageKey; value: string }[] = [
  { labelKey: "workbench.color.black", value: "#111827" },
  { labelKey: "workbench.color.graphite", value: "#4b5563" },
  { labelKey: "workbench.color.navy", value: "#1e3a8a" },
  { labelKey: "workbench.color.forest", value: "#166534" },
  { labelKey: "workbench.color.wine", value: "#7f1d1d" },
];

/** 合法的十六进制颜色（与后端 `_HEX_COLOR_RE` 同宽：3 位或 6 位）。 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

interface Props {
  layout: ResumeLayout;
  /** 打开这份简历时的版式快照：每行右侧那颗 ↺ 恢复的就是它（只有制作台传）。 */
  baseline?: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  disabled?: boolean;
  /** 拖动取色时的即时反馈通道（与制作台右栏的预览句柄是同一个）。 */
  previewRef?: RefObject<ResumePreviewHandle | null>;
  onChange: (layout: ResumeLayout) => void;
}

export default function ResumeColorControls({
  layout,
  baseline,
  catalog,
  disabled = false,
  previewRef,
  onChange,
}: Props) {
  // 外观四行的行名与 `aria-label` 都读这一个 `locale`：英文界面取目录的 `label_en`，
  // 取不到回落 `label`（中文界面输出与改动前逐字相同）。
  const locale = useLocale();
  // #12：色板手风琴——一次只展开一行，**默认全部收起**（规格：四行总高 ≤120px、先选行才
  // 出色板）。四行各挂一排色块时外观组高得离谱且视觉噪音大；点这一行任意位置或行头箭头
  // 展开它，展开新行时自动收起旧行。初值刻意不是 "accent"：默认展开一行会让"外观"一进来
  // 就有 40px 的色板把后面几行挤出可视区。
  const [openKey, setOpenKey] = useState<ColorKey | null>(null);
  // 防抖/即时提交要读"提交那一刻"的 layout：与度量控件同一个理由（父组件可能在
  // 这期间改了页数或模板，用旧快照会把那些改动覆盖回去）。
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  const config = layout.format_config;
  // 版式预设里的颜色同样优先于模板默认（模板 < 版式 < 手动微调）。
  const presetConfig = catalog?.format_presets?.find(
    (item) => item.name === layout.format_name,
  )?.config;
  const defaultHint = presetConfig
    ? t("resume.measure.hintPreset")
    : t("resume.measure.hintTemplate");

  /** 读这一项自己的覆盖：只认合法十六进制，别的一律当"没设过"。 */
  const ownColor = (key: ColorKey): string | null => {
    const raw = config?.[key];
    return typeof raw === "string" && HEX_COLOR.test(raw) ? raw.toLowerCase() : null;
  };
  /** 生效值：自己的覆盖 > 版式预设 > `null`（= 模板自己的 `:root`）。 */
  const effectiveColor = (key: ColorKey): string | null => {
    const own = ownColor(key);
    if (own) return own;
    const preset = presetConfig?.[key];
    return typeof preset === "string" && HEX_COLOR.test(preset) ? preset.toLowerCase() : null;
  };

  /** 写颜色：`null` = 删键（回到模板/版式）。 */
  const writeColor = (key: ColorKey, value: string | null) => {
    const current = layoutRef.current;
    const rest = { ...(current.format_config ?? {}) };
    if (value === null) {
      delete rest[key];
    } else {
      rest[key] = value.toLowerCase();
    }
    onChange({ ...current, format_config: rest });
  };

  const applyProbe = (css: string) => {
    previewRef?.current?.setLiveProbe(css);
  };

  /** 预览里立刻生效 + 落库（颜色是离散选择，没有连续拖动，所以不做防抖）。 */
  const commit = (key: ColorKey, value: string) => {
    const text = value.toLowerCase();
    applyProbe(colorProbeCss(key, text));
    writeColor(key, text);
  };

  const reset = (key: ColorKey) => {
    if (ownColor(key) === null) return;
    applyProbe("");
    writeColor(key, null);
  };

  /**
   * 「恢复到打开时的值」：把基线里这个键的取值搬回来（基线没有就删掉）。
   * 与 `reset`（删键回模板/版式）是两件事，见 `utils/paramRestore` 的表。
   */
  const restoreColor = (key: ColorKey) => {
    applyProbe("");
    onChange({
      ...layout,
      format_config: restoreFormatKeys(layout.format_config, baseline?.format_config, [key]),
    });
  };

  return (
    <div className="resume-wb-rows">
      {COLOR_KEYS.map((key) => {
        const label = formatFieldLabelOf(catalog?.format_fields, key, locale, key);
        const current = effectiveColor(key);
        const customized = ownColor(key) !== null;
        // 与打开时不同才长出 ↺：这一格本来就是"来源说明"的位置，两者互斥。
        const canRestore = baseline
          ? formatKeysDiffer(config, baseline.format_config, [key])
          : false;
        const expanded = openKey === key;
        return (
          <div
            className="resume-wb-color-row"
            key={key}
            onClick={(event) => {
              // 整行可点：不必先找到行头那颗小箭头。取色器 / 色板 / 恢复默认按钮 /
              // 来源胶囊自己处理点击，冒泡到这一层时直接放行，否则点开取色器会顺手把行收起。
              const target = event.target;
              if (!(target instanceof Element)) return;
              if (
                target.closest(
                  ".resume-wb-color-toggle, .resume-wb-swatches, .resume-measure-source, .ant-color-picker",
                )
              ) {
                return;
              }
              setOpenKey(expanded ? null : key);
            }}
          >
            <div className="resume-wb-color-head">
              {/* #12：行头箭头 = 展开该行色板（一次只展开一行）；整行点击与它同义。 */}
              <button
                type="button"
                className="resume-wb-color-toggle"
                aria-expanded={expanded}
                aria-label={t("workbench.param.paletteAria", { label })}
                onClick={() => setOpenKey(expanded ? null : key)}
              >
                {expanded ? "▾" : "▸"}
              </button>
              {/* 双击标题恢复默认：与滑杆那几行同一套手势（键盘侧 Enter / 空格）。 */}
              <Tooltip title={t("workbench.param.reset")}>
                <span
                  className="resume-measure-label"
                  role="button"
                  tabIndex={0}
                  aria-label={t("workbench.param.resetLabel", { label })}
                  onDoubleClick={() => reset(key)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    reset(key);
                  }}
                >
                  {label}
                </span>
              </Tooltip>
              <ColorPicker
                size="small"
                disabled={disabled}
                // 无覆盖时显示中性深灰起步（红斜线占位会被当成"坏了"）；值列如实说「跟随模板」。
                value={current ?? "#374151"}
                aria-label={t("workbench.param.colorAria", { label })}
                // 拖动色轮期间不要提交：`onChangeComplete` 只在选定后触发一次，
                // 一次取色 = 一次重渲染请求。
                onChangeComplete={(color) => commit(key, color.toHexString())}
              />
              {/* 读数格只放**值**：无覆盖时它是空的（问题 23）。原来这里回落到
                  「随模板」，而右侧来源胶囊说的也是「随模板」——同一句话在一行里出现
                  两次，既让人以为有两列状态，又白吃 44 + 6 = 50px。滑杆那几行的分工
                  本来就是"读数放值、胶囊放来源"，颜色行跟着对齐。 */}
              <Typography.Text type="secondary" className="resume-measure-value">
                {current ?? ""}
              </Typography.Text>
              <span className={`resume-measure-source${customized ? " is-empty" : ""}`}>
                {canRestore ? (
                  <ParamResetButton label={label} onReset={() => restoreColor(key)} />
                ) : customized ? (
                  ""
                ) : (
                  defaultHint
                )}
              </span>
            </div>
            {/* 预设色板：手风琴展开行才渲染；色值经自定义属性交给 CSS。 */}
            {expanded && (
              <div
                className="resume-wb-swatches"
                role="group"
                aria-label={t("workbench.color.palette")}
              >
                {PALETTE.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`resume-wb-swatch${current === item.value ? " is-active" : ""}`}
                    aria-label={t(item.labelKey)}
                    aria-pressed={current === item.value}
                    disabled={disabled}
                    style={{ "--resume-wb-swatch": item.value } as CSSProperties}
                    onClick={() => commit(key, item.value)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
