// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · **外观**组（简历制作台左栏）：强调色 / 正文颜色 / 辅助文字颜色 / 分隔线颜色 /
 * 条目标题颜色（T08 第 5 格）。
 *
 * ## 为什么前四个是平面键、第 5 个不是
 *
 * 前四项就是后端 `FORMAT_FIELDS` 里 `type: "color"` 的四项（`resume_template_format.py:41-44`），
 * 落点 `format_config[<key>]`，由 `format_css` 翻成 `:root { --accent: …; }`。**不新增键**，
 * 所以目录下发什么标签这里就显示什么——`label` 只有一份来源（与「自制版式」编辑器同一份）。
 *
 * 条目标题不同：模板的 `.entry-head .title` 一律没写 `color`，它继承 `body`（= `--text`），
 * 所以改「正文」会连带把条目标题一起改掉。要单独控它只能用已有的角色级覆盖
 * `format_config.roles.entry_title.color`（HTML/PDF/Word 全链路支持，入口原本在
 * 「样式 → 角色样式」）。这里写的是**同一个值**，不是新键。
 *
 * ## I-09：四行手风琴换成 2×2 色卡；T08：第 5 格独占一行
 *
 * 每格一张卡：色块（22px，带 1px 边框）+ 名称 + 色值，点卡片任意位置打开取色器。
 * 色块显示的是**生效色**，四级：`自己的覆盖 > 版式预设 > 模板配色（后端按模板下发）
 * > 占位`。第四级（自制模板 / 旧后端没有 palette）画斜纹 + 「随模板」，**不编造假色值**。
 * 第 5 格的生效值是「自己的覆盖 > 正文色」——未设时就是"随正文"，把真正继承到的颜色写出来。
 *
 * 取色器只有一个实例，跟着"点开的那一格"移动——五格各挂一个会明显加重左栏渲染开销。
 *
 * ## 恢复 = 删键
 *
 * 删掉即回到上一级来源（版式预设 → 模板的 `:root` 变量），而不是把"上一级的颜色"抄进
 * `format_config`：以后模板/预设换配色时，这些简历才跟着变。卡右上那颗 ↺ 与双击名称是
 * 同一个动作（老用户的快捷手势保留）。
 *
 * ## 写 `roles` 必须走 `withRoleProp`
 *
 * 自己拼 `{ ...config, roles: { ...roles, entry_title: { color } } }` 会在清掉最后一个
 * 属性时留下 `roles.entry_title: {}`——角色样式面板按"空对象 = 没有覆盖"读，两处口径
 * 就此分叉（面板会说"已调整 0 项"却仍挡着模板继承）。`withRoleProp` 已经在删空时把
 * 整个 role 键摘掉。
 */
import { ColorPicker, Tooltip } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import { t, type MessageKey } from "../../../i18n";
import { colorProbeCss, entryTitleColorProbeCss } from "../../../utils/resumeFormatProbe";
import { formatFieldLabelOf } from "../../../utils/resumeFormatLabels";
import { formatKeysDiffer, restoreFormatKeys } from "../../../utils/paramRestore";
import HintDetail from "../../../components/common/HintDetail";
import ParamResetButton from "./ParamResetButton";
import { ROLE_LABELS } from "./styleCatalog";
import { readRoleStyle, readStyleDomains, withRoleProp } from "./styleOverrides";
import { useLocale } from "../../../i18n/i18nContext";

/** 四个颜色键（顺序即左栏里的格序，与目录 `FORMAT_FIELDS` 同序）。 */
const COLOR_KEYS = ["accent", "text_color", "muted_color", "line_color"] as const;

type ColorKey = (typeof COLOR_KEYS)[number];

/** 第 5 格：角色键（`format_config.roles.entry_title.color`），不是平面键。 */
const ENTRY_TITLE = "entry_title" as const;

/** 取色器可能挂在前四格，也可能挂在第 5 格。 */
type PickerKey = ColorKey | typeof ENTRY_TITLE;

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

/** 合法十六进制才算"设过"，别的一律当没有（读宽容，与 `readStyleDomains` 同口径）。 */
function hexOf(raw: unknown): string | null {
  return typeof raw === "string" && HEX_COLOR.test(raw) ? raw.toLowerCase() : null;
}

/**
 * 一格色卡的**数据**（不放回调）。
 *
 * 为什么不在里面塞 `commit` / `reset` / `restore`：那三件事都要读 `previewRef`，而
 * `react-hooks/refs` 会把"渲染期间构造出的对象里带读 ref 的闭包、又在 JSX 里取用"
 * 判成渲染期读 ref。回调统一按 `key` 在 JSX 里当场选（见 `commitCell` 一族）。
 */
interface ColorCell {
  key: PickerKey;
  label: string;
  /** 生效色；`null` = 连上一级来源都没有（自制模板 / 旧后端）。 */
  value: string | null;
  /** 是不是用户自己的覆盖（决定 ↺ 与来源词）。 */
  customized: boolean;
  /** 没有覆盖时的来源说明（随模板 / 随版式 / 随正文）。 */
  sourceHint: string;
  canRestore: boolean;
  /** 第 5 格独占一行。 */
  wide: boolean;
}

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
  // 五格的名称都读这一个 `locale`：英文界面取目录的 `label_en`，取不到回落 `label`
  // （中文界面输出与改动前逐字相同）。第 5 格直接复用角色名（同一个概念只有一份文案）。
  const locale = useLocale();
  /** 当前打开取色器的那一格；`null` = 弹层关着（**只渲染一个** ColorPicker）。 */
  const [pickerKey, setPickerKey] = useState<PickerKey | null>(null);
  // 弹层开合由本组件受控：点另一张卡时要先关旧的，否则会两个弹层叠着。
  const [pickerOpen, setPickerOpen] = useState(false);
  // 上面那个 state 的同步镜像：旧取色器卸载 / 点外关闭时会补一次 `onOpenChange(false)`，
  // 那一下晚于"点新卡"的 onClick，会把新卡的 `open` 又按回 false。判据必须是"这个事件
  // 属于当前这张卡"，而不是"弹层关了"。**同步写**（不能放 useEffect）：卡的卸载发生在
  // 这次点击的提交阶段，effect 还没跑。
  const pickerKeyRef = useRef<PickerKey | null>(null);
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
  const ownColor = (key: ColorKey): string | null => hexOf(config?.[key]);
  /** 版式预设里的这一项（合法十六进制才算）。 */
  const presetColor = (key: ColorKey): string | null => hexOf(presetConfig?.[key]);
  /** 模板自己 `:root` 里的这一项。 */
  const templateColor = (key: ColorKey): string | null => hexOf(templatePalette?.[key]);
  /** 生效值：自己的覆盖 > 版式预设 > 模板配色 > `null`（没有任何配色数据）。 */
  const effectiveColor = (key: ColorKey): string | null =>
    ownColor(key) ?? presetColor(key) ?? templateColor(key);

  /** 第 5 格自己的覆盖（角色级；目录 / 后端都不存在这一项时为空）。 */
  const ownEntryTitle = hexOf(readRoleStyle(readStyleDomains(config), ENTRY_TITLE).color);
  /** 基线里第 5 格的值（用于「恢复到打开时的值」）。 */
  const baselineEntryTitle = hexOf(
    readRoleStyle(readStyleDomains(baseline?.format_config), ENTRY_TITLE).color,
  );

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

  /**
   * 写第 5 格：`withRoleProp` 负责"删空即摘掉整个 role"，与角色样式面板同一份实现。
   *
   * **不要**换成 `clearRole`：那会把用户在「角色样式 → 条目标题」里调过的字号 / 粗细
   * 一起清掉——这里是"复位这一个颜色"，不是"重置这个角色"。
   */
  const writeEntryTitle = (value: string | null) => {
    const current = layoutRef.current;
    onChange({
      ...current,
      format_config: withRoleProp(current.format_config, ENTRY_TITLE, "color", value),
    });
  };

  /** 预览里立刻生效 + 落库（颜色是离散选择，没有连续拖动，所以不做防抖）。 */
  const commit = (key: ColorKey, value: string) => {
    const text = value.toLowerCase();
    previewRef?.current?.setLiveProbe(colorProbeCss(key, text));
    writeColor(key, text);
  };

  /** 第 5 格的探针写的是角色规则（不是 `:root` 变量），见 `entryTitleColorProbeCss`。 */
  const commitEntryTitle = (value: string) => {
    const text = value.toLowerCase();
    previewRef?.current?.setLiveProbe(entryTitleColorProbeCss(text));
    writeEntryTitle(text);
  };

  const reset = (key: ColorKey) => {
    if (ownColor(key) === null) return;
    previewRef?.current?.setLiveProbe("");
    writeColor(key, null);
  };

  const resetEntryTitle = () => {
    if (ownEntryTitle === null) return;
    previewRef?.current?.setLiveProbe("");
    writeEntryTitle(null);
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

  /** 第 5 格同理：`paramRestore` 只认平面键，角色键在这里单独搬。 */
  const restoreEntryTitle = () => {
    previewRef?.current?.setLiveProbe("");
    onChange({
      ...layout,
      format_config: withRoleProp(layout.format_config, ENTRY_TITLE, "color", baselineEntryTitle),
    });
  };

  // 第 5 格直接拼在数组字面量里：五格的**数据**一次算完，回调按 `key` 在 JSX 当场选。
  const cells: ColorCell[] = [
    ...COLOR_KEYS.map((key): ColorCell => {
      const label = formatFieldLabelOf(catalog?.format_fields, key, locale, key);
      const customized = ownColor(key) !== null;
      return {
        key,
        label,
        value: effectiveColor(key),
        customized,
        // 来源说明：只有"不是自己的覆盖"时才说得出口（随版式 / 随模板）。
        sourceHint: customized ? "" : defaultHint,
        // 与打开时不同才长出「恢复到打开时的值」：这一格本来就是 ↺ 的位置，两者互斥。
        canRestore: baseline ? formatKeysDiffer(config, baseline.format_config, [key]) : false,
        wide: false,
      };
    }),
    {
      key: ENTRY_TITLE,
      // 与「角色样式」面板同一个标签：同一个概念不许有两套叫法。
      label: t(ROLE_LABELS.entry_title),
      // 未设时显示的**就是正文色**——模板里条目标题继承 `body`，这是它真正呈现的颜色。
      value: ownEntryTitle ?? effectiveColor("text_color"),
      customized: ownEntryTitle !== null,
      sourceHint: ownEntryTitle !== null ? "" : t("workbench.color.followBody"),
      canRestore: baseline ? ownEntryTitle !== baselineEntryTitle : false,
      wide: true,
    },
  ];

  /** 五格共用的三个动作：第 5 格走角色级覆盖，前四格走平面键。 */
  const commitCell = (key: PickerKey, hex: string) =>
    key === ENTRY_TITLE ? commitEntryTitle(hex) : commit(key, hex);
  const resetCell = (key: PickerKey) => (key === ENTRY_TITLE ? resetEntryTitle() : reset(key));
  const restoreCell = (key: PickerKey) =>
    key === ENTRY_TITLE ? restoreEntryTitle() : restoreColor(key);

  /** 关弹层 = 卸载那一个取色器（不要留一个 `open=false` 的空壳在卡片里）。 */
  const closePicker = () => {
    pickerKeyRef.current = null;
    setPickerOpen(false);
    setPickerKey(null);
  };

  return (
    <div className="resume-wb-colors">
      {cells.map((cell) => {
        const { key, label, value, customized } = cell;
        const active = pickerKey === key;
        // 没有色值时的状态词：前四格「随模板」，第 5 格「随正文」（它没有模板变量）。
        const followLabel =
          key === ENTRY_TITLE
            ? t("workbench.color.followBody")
            : t("workbench.color.followTemplate");
        return (
          <div
            className={`resume-wb-color-card${active ? " is-open" : ""}${cell.wide ? " is-wide" : ""}`}
            key={key}
          >
            <button
              type="button"
              className="resume-wb-color-main"
              disabled={disabled}
              // 读屏要能听出"这是什么颜色、从哪来"：名称 + 色值 + 来源，缺一不可。
              aria-label={[
                t("workbench.param.colorAria", { label }),
                value ?? followLabel,
                cell.sourceHint,
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
                className={`resume-wb-color-chip${value ? "" : " is-fallback"}`}
                // 颜色值是**数据**（用户选的颜色跟导出走），经自定义属性交给 CSS，
                // 不写 `style={{ background }}`（`inlineColorGuard` 的口径）。
                style={value ? ({ "--resume-wb-chip": value } as CSSProperties) : undefined}
              />
              <span className="resume-wb-color-text">
                <Tooltip title={t("workbench.param.reset")}>
                  <span
                    className="resume-wb-color-name"
                    // 双击名称 = 删键回上一级来源（老用户手势，与卡片右上 ↺ 同一个动作）。
                    onDoubleClick={() => {
                      closePicker();
                      resetCell(key);
                    }}
                  >
                    {label}
                  </span>
                </Tooltip>
                <span className="resume-wb-color-value">
                  {value ?? followLabel}
                  {/* 有色值且不是自己的覆盖时，才在色值后面补来源词（随模板 / 随版式 / 随正文）；
                      没有色值时上一句已经是那个词，再补一次就是重复。 */}
                  {value && !customized ? (
                    <span className="resume-wb-color-source"> · {cell.sourceHint}</span>
                  ) : null}
                </span>
              </span>
            </button>
            {cell.canRestore ? (
              <ParamResetButton label={label} onReset={() => restoreCell(key)} />
            ) : customized ? (
              <button
                type="button"
                className="resume-wb-color-reset"
                disabled={disabled}
                title={t("workbench.param.reset")}
                aria-label={`${label} · ${t("workbench.param.reset")}`}
                onClick={() => {
                  closePicker();
                  resetCell(key);
                }}
              >
                <UndoOutlined />
              </button>
            ) : null}
            {active ? (
              <ColorPicker
                // 一个实例跟着"点开的那一格"走：五格各挂一个会明显加重左栏渲染开销。
                className="resume-wb-color-picker"
                open={pickerOpen}
                onOpenChange={(open) => {
                  // 只认"当前这张卡"的开合：旧实例卸载时补的那一次 false 必须丢掉。
                  if (open) setPickerOpen(true);
                  else if (pickerKeyRef.current === key) closePicker();
                }}
                disabled={disabled}
                value={value ?? "#374151"}
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
                  if (PALETTE.some((item) => item.value === hex)) commitCell(key, hex);
                }}
                onChangeComplete={(color) => commitCell(key, color.toHexString())}
              />
            ) : null}
          </div>
        );
      })}
      <div className="resume-wb-colors-hint">
        <HintDetail
          detail={t("workbench.color.entryTitleHint")}
          label={t("workbench.color.entryTitleHintAria")}
        />
      </div>
    </div>
  );
}
