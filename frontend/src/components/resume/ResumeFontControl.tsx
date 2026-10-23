// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体选择（项 14）：这份简历用哪一款**已上传**的字体。
 *
 * ## 为什么不是"整站字体"的第二个开关
 *
 * 设备上已经有一个"当前字体"（设置 → 应用 → 简历字体，R10）。这里选的是**这一份简历**
 * 用哪一款，存在它自己的 `format_config.font` 里，跟着简历走、跟着导出走。所以三者是：
 *
 * - **没设过**（老简历）→ 跟随设备上的当前字体（历史行为，外观不追溯改变）；
 * - **选了某款** → 就用它；
 * - **`__system__`** → 显式"这份简历不用自定义字体"。它与"没设过"是两种语义，所以写值
 *   **不删键**（删键等于回到"跟随设备当前字体"）。
 *
 * ## 字形预览
 *
 * 字体文件同源提供（`/api/settings/fonts/<name>/file`），所以下拉**打开时**才注入一份
 * `@font-face` 到 `document.head`，每个选项用自己的 `font-family` 渲染成它自己的样子。
 * 关掉就移除：常驻会让每个页面都白下载一遍几十 MB 的字体文件。
 */
import { Select, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { listResumeFonts, resumeFontPreviewUrl } from "../../api/settings";
import { useApi } from "../../hooks/useApi";
import type { ResumeLayout } from "../../types";

/** 与后端 `resume_template_format.SYSTEM_FONT` **逐字一致**（两处只有一个含义）。 */
export const SYSTEM_FONT_VALUE = "__system__";

/** 下拉选项：`family` 只有"已上传字体"才有（系统字体没有文件可注入）。 */
interface FontOption {
  value: string;
  label: string;
  /** 已上传字体的原始文件名（显示的是展示名，旁边仍标出磁盘上的文件）。 */
  fileName?: string;
  family?: string;
}

const SYSTEM_OPTION: FontOption = {
  value: SYSTEM_FONT_VALUE,
  label: "系统字体（不使用自定义字体）",
};

/**
 * 关闭态里显示的短名。
 *
 * 这一格与上一行的页边距滑杆同宽（200px），全称会被截成「系统字体（不使用自定义…」，
 * 反而不好认。完整说明留在展开的列表里（那里有整行宽度），选中态只要说清"现在是系统字体"。
 * 原生 title 仍是全称，悬停可看。
 */
const SYSTEM_FONT_SHORT_LABEL = "系统字体";

interface Props {
  layout: ResumeLayout;
  onChange: (layout: ResumeLayout) => void;
  /** 紧凑模式：只收窄控件宽度（分组标签由宿主渲染）。 */
  compact?: boolean;
  /**
   * 与上一行（页边距）的滑杆**同宽同起点**（弹窗模式用）。
   *
   * 排版栏里这一格在「页边距」正下方，而滑杆左侧还有一颗减号按钮（30px）与两道间距。
   * 下拉若只跟着标签走，就会比滑杆更靠左、也更宽，两行看起来像没对齐。这里由
   * `.resume-measure-grid.is-stacked .resume-font-select.is-fluid` 补足那段偏移，
   * 宽度也取滑杆的 200px。`compact` 与它互斥：工具栏按内容宽度排。
   */
  alignWithSlider?: boolean;
  /** 与同组其它控件同样可禁用（查看态 / 保存中）。 */
  disabled?: boolean;
}

export default function ResumeFontControl({
  layout,
  onChange,
  compact = false,
  alignWithSlider = false,
  disabled = false,
}: Props) {
  const { data } = useApi(listResumeFonts, []);
  const items = useMemo(() => data?.items ?? [], [data]);
  const activeName = data?.active ?? null;
  const [open, setOpen] = useState(false);

  /**
   * 当前值：**没设过就显示设备上当前那个字体**——那才是真正会被用到的字形。
   * 显示成别的（例如一个"未选择"的空值）会让用户以为导出会跟预览不一样。
   */
  const configured = layout.format_config?.["font"];
  const currentValue =
    typeof configured === "string" && configured ? configured : (activeName ?? SYSTEM_FONT_VALUE);

  const options = useMemo<FontOption[]>(() => {
    const fonts = items.map((font, index) => {
      // 显示名可自定义；文件名保持可见（悬停时给出），排查问题时才对得上磁盘。
      const display = font.display_name || font.name;
      return {
        value: font.name,
        // 「当前全局」标在设备上当前选中的那一项后面：它与"这份简历选了它"是两件事。
        label: font.name === activeName ? `${display}（当前全局）` : display,
        fileName: font.name,
        family: `rf-opt-${index}`,
      };
    });
    return [SYSTEM_OPTION, ...fonts];
  }, [activeName, items]);

  // 字形预览：只在打开下拉时注入，关闭即移除（见文件头注释）。
  const previewCss = useMemo(
    () =>
      options
        .filter((option) => option.family)
        .map(
          (option) =>
            `@font-face{font-family:"${option.family}";` +
            `src:url("${resumeFontPreviewUrl(option.value)}");font-display:swap;}`,
        )
        .join("\n"),
    [options],
  );

  useEffect(() => {
    if (!open || !previewCss) return undefined;
    const style = document.createElement("style");
    style.setAttribute("data-rf-font-options", "true");
    style.textContent = previewCss;
    document.head.appendChild(style);
    return () => style.remove();
  }, [open, previewCss]);

  if (items.length === 0) {
    // 没有任何已上传字体时不渲染 Select：一个只能选"系统字体"的下拉没有信息量，
    // 直接告诉用户去哪里加字体更有用。
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        还没有导入字体，去 设置 → 应用 → 简历字体 上传
      </Typography.Text>
    );
  }

  return (
    <Select
      size="small"
      aria-label="简历字体"
      value={currentValue}
      options={options}
      disabled={disabled}
      className={`resume-font-select${alignWithSlider ? " is-fluid" : ""}`}
      // 弹窗（对齐滑杆）：宽度与左侧偏移交给 CSS（`.is-stacked .resume-font-select`），
      // 因为要对齐的是滑杆的像素位置，而不是"把剩余宽度吃掉"。
      style={alignWithSlider ? undefined : { width: compact ? 140 : 176 }}
      // 弹层**不**跟着触发框，也**不**按内容撑开（2026-11-06 用户截图：长字体名把弹层
      // 拉到半屏，甚至被窗口右缘裁掉）。宽度由 `.resume-params-dropdown` 定在参数栏
      // 内容宽 340px，选项文字单行省略、悬停看全称（见 `optionRender`）。
      popupMatchSelectWidth={false}
      classNames={{ popup: { root: "resume-params-dropdown" } }}
      // 选中态用短名（见 `SYSTEM_FONT_SHORT_LABEL`）：这一格与页边距滑杆同宽 200px，
      // 全称必然被截成「系统字体（不使用自定义…」。展开的列表与 title 仍是完整说明。
      labelRender={(props) =>
        props.value === SYSTEM_FONT_VALUE ? SYSTEM_FONT_SHORT_LABEL : props.label
      }
      onOpenChange={setOpen}
      // 每个选项用自己的字形渲染：用户挑字体时看的就是字形本身。
      optionRender={(option) => (
        <span
          className="resume-font-option"
          style={
            option.data.family ? { fontFamily: `"${option.data.family}", sans-serif` } : undefined
          }
          // 弹层宽度定死之后长名字必然被截断，完整文本靠原生 title 兜住。
          // 只在"展示名 ≠ 文件名"时才挂：两者相同时 antd 已经用 label 生成过一个
          // **同名** title，再挂一层会让 `getByTitle` 命中两个节点（测试与读屏都会懵）。
          title={
            option.data.fileName && option.data.fileName !== option.data.label
              ? `${option.data.label} · ${option.data.fileName}`
              : undefined
          }
        >
          {/* 展示名单独一层：它与文件名各自单行省略，只给外层省略时文件名会把展示名
              挤掉，而展示名才是用户认字体的依据。 */}
          <span className="resume-font-option-name">{option.data.label}</span>
          {/* 展示名可以自定义，但原始文件名要在选项里看得见：两份字体长得像时，
              真正能区分它们的是磁盘上的文件名。 */}
          {option.data.fileName ? (
            <span className="resume-font-option-file">{option.data.fileName}</span>
          ) : null}
        </span>
      )}
      onChange={(next: string) => {
        // `__system__` 也写成值（不删键）：删键 = "跟随设备当前字体"，是另一种语义。
        onChange({ ...layout, format_config: { ...layout.format_config, font: next } });
      }}
    />
  );
}
