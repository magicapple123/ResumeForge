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
 * ## I-09：四行手风琴换成 2×2 色卡
 *
 * 老形态是「▸ 箭头 | 标签 | 20px 色块 | 空读数格 | 随模板胶囊」，色块在"随模板"时统一传
 * 占位色 `#374151`——四行长得一模一样，看不出四个颜色各是什么。现在每格一张卡：
 * 色块（22px，带 1px 边框）+ 名称 + 色值，点卡片任意位置打开取色器。
 *
 * 色块显示的是**生效色**，四级：`自己的覆盖 > 版式预设 > 模板配色（后端按模板下发）
 * > 占位`。第四级（自制模板 / 旧后端没有 palette）画斜纹 + 「随模板」，**不编造假色值**。
 *
 * 取色器只有一个实例，跟着"点开的那一格"移动——四格各挂一个会明显加重左栏渲染开销。
 *
 * ## 恢复 = 删键
 *
 * 删掉即回到上一级来源（版式预设 → 模板的 `:root` 变量），而不是把"上一级的颜色"抄进
 * `format_config`：以后模板/预设换配色时，这些简历才跟着变。卡右上那颗 ↺ 与双击名称是
 * 同一个动作（老用户的快捷手势保留）。
 */
import { ColorPicker, Tooltip } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import { t, type MessageKey } from "../../../i18n";
import { colorProbeCss } from "../../../utils/resumeFormatProbe";
import { formatFieldLabelOf } from "../../../utils/resumeFormatLabels";
import { formatKeysDiffer, restoreFormatKeys } from "../../../utils/paramRestore";
import ParamResetButton from "./ParamResetButton";
import { useLocale } from "../../../i18n/i18nContext";

/** 四个颜色键（顺序即左栏里的格序，与目录 `FORMAT_FIELDS` 同序）。 */
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
  /** 打开这份简历时的版式快照（面板里其它行用它做「恢复到打开时的值」）。 */
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
  // 外观四格的名称与 `aria-label` 都读这一个 `locale`：英文界面取目录的 `label_en`，
  // 取不到回落 `label`（中文界面输出与改动前逐字相同）。
  const locale = useLocale();
  /** 当前打开取色器的那一格；`null` = 弹层关着（**只渲染一个** ColorPicker）。 */
  const [pickerKey, setPickerKey] = useState<ColorKey | null>(null);
  // 弹层开合由本组件受控：点另一张卡时要先关旧的，否则会两个弹层叠着。
  const [pickerOpen, setPickerOpen] = useState(false);
  // 上面那个 state 的同步镜像：旧取色器卸载 / 点外关闭时会补一次 `onOpenChange(false)`，
  // 那一下晚于"点新卡"的 onClick，会把新卡的 `open` 又按回 false。判据必须是"这个事件
  // 属于当前这张卡"，而不是"弹层关了"。**同步写**（不能放 useEffect）：卡的卸载发生在
  // 这次点击的提交阶段，effect 还没跑。
  const pickerKeyRef = useRef<ColorKey | null>(null);
  // 提交要读"提交那一刻"的 layout：与度量控件同一个理由（父组件可能在这期间改了别的行）。
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
  // 模板配色：后端按模板下发（`resume_template_palette`）；旧后端 / 自制模板取不到。
  const templatePalette =
    catalog?.templates.find((item) => item.name === layout.template)?.palette ?? null;

  /** 读这一项自己的覆盖：只认合法十六进制，别的一律当"没设过"。 */
  const ownColor = (key: ColorKey): string | null => {
    const raw = config?.[key];
    return typeof raw === "string" && HEX_COLOR.test(raw) ? raw.toLowerCase() : null;
  };
  /** 版式预设里的这一项（合法十六进制才算）。 */
  const presetColor = (key: ColorKey): string | null => {
    const preset = presetConfig?.[key];
    return typeof preset === "string" && HEX_COLOR.test(preset) ? preset.toLowerCase() : null;
  };
  /** 模板自己 `:root` 里的这一项。 */
  const templateColor = (key: ColorKey): string | null => {
    const value = templatePalette?.[key];
    return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null;
  };
  /** 生效值：自己的覆盖 > 版式预设 > 模板配色 > `null`（没有任何配色数据）。 */
  const effectiveColor = (key: ColorKey): string | null =>
    ownColor(key) ?? presetColor(key) ?? templateColor(key);

  /** 写颜色：`null` = 删键（回到上一级来源）。 */
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

  /** 预览里立刻生效 + 落库（颜色是离散选择，没有连续拖动，所以不做防抖）。 */
  const commit = (key: ColorKey, value: string) => {
    const text = value.toLowerCase();
    previewRef?.current?.setLiveProbe(colorProbeCss(key, text));
    writeColor(key, text);
  };

  const reset = (key: ColorKey) => {
    if (ownColor(key) === null) return;
    previewRef?.current?.setLiveProbe("");
    writeColor(key, null);
  };

  /**
   * 「恢复到打开时的值」：把基线里这个键的取值搬回来（基线没有就删掉）。
   * 与 `reset`（删键回上一级来源）是两件事，见 `utils/paramRestore` 的表。
   */
  const restoreColor = (key: ColorKey) => {
    previewRef?.current?.setLiveProbe("");
    onChange({
      ...layout,
      format_config: restoreFormatKeys(layout.format_config, baseline?.format_config, [key]),
    });
  };

  /** 关弹层 = 卸载那一个取色器（不要留一个 `open=false` 的空壳在卡片里）。 */
  const closePicker = () => {
    pickerKeyRef.current = null;
    setPickerOpen(false);
    setPickerKey(null);
  };

  return (
    <div className="resume-wb-colors">
      {COLOR_KEYS.map((key) => {
        const label = formatFieldLabelOf(catalog?.format_fields, key, locale, key);
        const current = effectiveColor(key);
        const customized = ownColor(key) !== null;
        // 与打开时不同才长出「恢复到打开时的值」：这一格本来就是 ↺ 的位置，两者互斥。
        const canRestore = baseline
          ? formatKeysDiffer(config, baseline.format_config, [key])
          : false;
        // 来源说明：只有"不是自己的覆盖"时才说得出口（随版式 / 随模板）。
        const sourceHint = customized ? "" : defaultHint;
        const active = pickerKey === key;
        return (
          <div className={`resume-wb-color-card${active ? " is-open" : ""}`} key={key}>
            <button
              type="button"
              className="resume-wb-color-main"
              disabled={disabled}
              // 读屏要能听出"这是什么颜色、从哪来"：名称 + 色值 + 来源，缺一不可。
              aria-label={[
                t("workbench.param.colorAria", { label }),
                current ?? defaultHint,
                sourceHint,
              ]
                .filter(Boolean)
                .join(" · ")}
              onClick={() => {
                // 弹层受控：开一张卡要同时把 `open` 置真；再点同一张已打开的卡才收起。
                if (active && pickerOpen) {
                  closePicker();
                } else {
                  pickerKeyRef.current = key;
                  setPickerKey(key);
                  setPickerOpen(true);
                }
              }}
            >
              <span
                className={`resume-wb-color-chip${current ? "" : " is-fallback"}`}
                // 颜色值是**数据**（用户选的颜色跟导出走），经自定义属性交给 CSS，
                // 不写 `style={{ background }}`（`inlineColorGuard` 的口径）。
                style={current ? ({ "--resume-wb-chip": current } as CSSProperties) : undefined}
              />
              <span className="resume-wb-color-text">
                <Tooltip title={t("workbench.param.reset")}>
                  <span
                    className="resume-wb-color-name"
                    // 双击名称 = 删键回上一级来源（老用户手势，与卡片右上 ↺ 同一个动作）。
                    onDoubleClick={() => {
                      closePicker();
                      reset(key);
                    }}
                  >
                    {label}
                  </span>
                </Tooltip>
                <span className="resume-wb-color-value">
                  {current ?? t("workbench.color.followTemplate")}
                  {/* 有色值且不是自己的覆盖时，才在色值后面补来源词（随模板 / 随版式）；
                      没有色值时上一句已经是「随模板」，再补一次就是重复。 */}
                  {current && !customized ? (
                    <span className="resume-wb-color-source"> · {defaultHint}</span>
                  ) : null}
                </span>
              </span>
            </button>
            {canRestore ? (
              <ParamResetButton label={label} onReset={() => restoreColor(key)} />
            ) : customized ? (
              <button
                type="button"
                className="resume-wb-color-reset"
                disabled={disabled}
                title={t("workbench.param.reset")}
                aria-label={`${label} · ${t("workbench.param.reset")}`}
                onClick={() => {
                  closePicker();
                  reset(key);
                }}
              >
                <UndoOutlined />
              </button>
            ) : null}
            {active ? (
              <ColorPicker
                // 一个实例跟着"点开的那一格"走：四格各挂一个会明显加重左栏渲染开销。
                className="resume-wb-color-picker"
                open={pickerOpen}
                onOpenChange={(open) => {
                  // 只认"当前这张卡"的开合：旧实例卸载时补的那一次 false 必须丢掉。
                  if (open) setPickerOpen(true);
                  else if (pickerKeyRef.current === key) closePicker();
                }}
                disabled={disabled}
                value={current ?? "#374151"}
                presets={[
                  {
                    label: t("workbench.color.palette"),
                    colors: PALETTE.map((item) => item.value),
                    defaultOpen: true,
                  },
                ]}
                // antd 的**预设色块**走 `onChange`（`ColorPresets` 只接 `onChange`），
                // 色轮 / HEX 才走 `onChangeComplete`。只听后者会让"点一下预设"毫无反应。
                // 所以这里只在命中那 5 个预设时立即提交；拖动色轮期间 `onChange` 给的
                // 是连续值，不匹配任何预设，仍然等松手后的 `onChangeComplete` 提交一次。
                onChange={(color) => {
                  const hex = color.toHexString().toLowerCase();
                  if (PALETTE.some((item) => item.value === hex)) commit(key, hex);
                }}
                onChangeComplete={(color) => commit(key, color.toHexString())}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
