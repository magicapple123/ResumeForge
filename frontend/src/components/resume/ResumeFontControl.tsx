// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体选择（项 14）：这份简历用哪一款**本机已有文件**的字体。
 *
 * 2026-11 起"本机已有"包含两类：内置的思源黑体（按需下载）与升级前导入的历史字体。
 * 内置那款**没下载时**磁盘上没有文件，选中它既预览不出字形、导出也拿不到字体——
 * 但本批起它不再只能"禁用 + 指路去设置页"：**在这一行里就能下**（P0-3）。
 *
 * ## 这一行里下载，为什么不会改掉全局字体
 *
 * 设备上有一个"当前字体"（设置 → 应用 → 简历字体），这里选的是**这一份简历**用哪一款。
 * 所以下拉里点未下载的内置字体时，请求带的是 `activate=false`：
 *
 * ```ts
 * startBuiltinFontDownload({ activate: false })   // → POST ...?activate=false
 * ```
 *
 * 后端据此在下载完成后**不**接管全局 `active`；下载完成时我们只写这份简历自己的
 * `format_config.font`。两件事彻底分开：用户在制作台里下一个字体，不该改变设置页里
 * 其它简历的默认字形。
 *
 * ## 其余三条既有语义不变
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
 * 关掉就移除：常驻会让每个页面都白下载一遍几十 MB 的字体文件。未下载的那款不注入
 * （没有文件，注入只会换来一次 404）。
 */
import { App, Button, Select, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN_FONT_FILE, resumeFontPreviewUrl } from "../../api/fonts";
// 字体清单从 `api/settings` 取（同一个函数，它 re-export 自 `api/fonts`）：字号域那条
// 「拖动全程零网络」的用例（`ResumeLayoutControls.font.test.tsx`）mock 的入口就是
// `api/settings`，走新家会让这一次挂载读漏成真网络、把那条性能红线打红。
import { listResumeFonts } from "../../api/settings";
import { useBuiltinFontDownload } from "../../features/fonts/useBuiltinFontDownload";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import { useLocale } from "../../i18n/i18nContext";

/** 与后端 `resume_template_format.SYSTEM_FONT` **逐字一致**（两处只有一个含义）。 */
export const SYSTEM_FONT_VALUE = "__system__";

/** 下拉选项：`family` 只有"本机已有该字体文件"的才给（系统字体、未下载的内置字体都没有）。 */
interface FontOption {
  value: string;
  /** 展示名（名字可自定义）；第二行的状态/进度由 `note` 那一层说。 */
  label: string;
  /** 磁盘上的原始文件名：只用于 `title`（悬停看全）与排查，不再单独占一行。 */
  fileName?: string;
  /** 展示名与文件名不同时，`title` 给「展示名 · 文件名」；相同时交给 antd 用 label。 */
  display?: string;
  family?: string;
  /**
   * 内置字体且**还没下载**：点这一行等于"开始下载"，不是"选中它"。
   * 下载完成后清单会重拉，这一项随即变成普通可选项。
   */
  builtin?: boolean;
  disabled?: boolean;
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
  useLocale();
  const { message } = App.useApp();
  const { data, reload } = useApi(listResumeFonts, []);
  const items = useMemo(() => data?.items ?? [], [data]);
  const activeName = data?.active ?? null;
  const [open, setOpen] = useState(false);
  /**
   * 点"未下载的内置字体"只是**开始下载**，不是选择：弹层要留在原地，进度就在这一行里。
   * antd 选中后必然尝试关闭弹层，所以用一个一次性标记把它按回去。
   */
  const keepOpenRef = useRef(false);

  /**
   * 下载完成：**只写这一份简历**的字体，并且只写一次（`onDownloaded` 只对本次点击触发的
   * 下载回调一次）。不调 `activateResumeFont`——那是设置页"设为当前"的语义。
   */
  const handleDownloaded = useCallback(() => {
    message.success(t("fontDownload.downloadedAndSet"));
    onChange({
      ...layout,
      format_config: { ...layout.format_config, font: BUILTIN_FONT_FILE },
    });
  }, [layout, message, onChange]);

  const download = useBuiltinFontDownload({
    /**
     * **读取权收回来**：状态只在下拉展开时读（见下面的 effect）。
     *
     * 这一格挂在字号滑杆旁边，会被参数栏反复渲染；若 hook 挂载即读，就会给
     * 「拖动字号滑杆全程零网络」那条性能红线凭空加一次请求。
     */
    manual: true,
    // **关键**：`activate: false` → 请求带 `?activate=false`，后端不接管全局字体。
    activate: false,
    onDownloaded: handleDownloaded,
    onChanged: () => void reload(),
  });
  const { refresh: refreshBuiltin } = download;

  /**
   * 内置字体状态**只在下拉真正展开时**读一次。
   *
   * 不在挂载时读是硬约束：这一格会被字号滑杆所在的参数栏反复渲染，而那条控件的既有
   * 契约是"拖动全程零网络"（`ResumeLayoutControls.font.test.tsx` 钉着它）。展开下拉
   * 才意味着用户要看字体，此刻多一次 GET 才是合理的。
   */
  useEffect(() => {
    if (!open) return;
    void refreshBuiltin();
  }, [open, refreshBuiltin]);

  /**
   * 当前值：**没设过就显示设备上当前那个字体**——那才是真正会被用到的字形。
   * 显示成别的（例如一个"未选择"的空值）会让用户以为导出会跟预览不一样。
   */
  const configured = layout.format_config?.["font"];
  const currentValue =
    typeof configured === "string" && configured ? configured : (activeName ?? SYSTEM_FONT_VALUE);

  const options = useMemo<FontOption[]>(() => {
    const fonts = items.map((font, index) => {
      const display = font.display_name || font.name;
      // 内置条目还没下载：磁盘上没有这个文件，注入 @font-face 只会换来一次 404，
      // 但**不再禁用**——点它就是去下载（下载完成后清单重拉，它会变成普通可选项）。
      const undownloaded = font.downloaded === false;
      return {
        value: font.name,
        label: undownloaded
          ? display
          : font.name === activeName
            ? `${display}（当前全局）`
            : display,
        // 完整信息放进 title：弹层只有 260px，展示名与文件名不可能并排放下。
        fileName: font.name,
        display,
        family: undownloaded ? undefined : `rf-opt-${index}`,
        builtin: Boolean(font.builtin && undownloaded),
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

  /** 点未下载的内置字体：开始下载（只落文件，不改全局字体），弹层不关。 */
  const startBuiltin = useCallback(() => {
    keepOpenRef.current = true;
    void download.start();
    setOpen(true);
  }, [download]);

  if (items.length === 0) {
    // 一款可用字体都没有时不渲染 Select：一个只能选"系统字体"的下拉没有信息量，
    // 直接告诉用户最近的那条路（下载内置的思源黑体）更有用。
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("fonts.control.empty")}
      </Typography.Text>
    );
  }

  const total = download.status?.total_bytes ?? 0;
  const done = download.status?.downloaded_bytes ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  /**
   * 未下载的内置字体那一行的第二行：三种态各一句话（+ 行内按钮）。
   * 取消 / 重试必须 `stopPropagation`：否则点它顺带把这一行"选中"了。
   */
  const builtinNote = () => {
    if (download.downloading) {
      return (
        <span className="resume-font-option-note">
          <span>
            {download.cancelling
              ? t("fontDownload.canceling")
              : t("fontDownload.progress", { percent })}
          </span>
          <Button
            type="link"
            size="small"
            loading={download.busy}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              void download.cancel();
            }}
          >
            {t("fontDownload.cancel")}
          </Button>
        </span>
      );
    }
    if (download.state === "failed") {
      return (
        <span className="resume-font-option-note">
          <span>
            {t("fontDownload.downloadFailed", {
              error: download.startError || download.status?.error || "",
            })}
          </span>
          <Button
            type="link"
            size="small"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              void download.start();
            }}
          >
            {t("fontDownload.retry")}
          </Button>
        </span>
      );
    }
    return <span className="resume-font-option-note">{t("fontDownload.optionHint")}</span>;
  };

  return (
    <Select
      size="small"
      aria-label="简历字体"
      value={currentValue}
      options={options}
      disabled={disabled}
      open={open}
      className={`resume-font-select${alignWithSlider ? " is-fluid" : ""}`}
      // 弹窗（对齐滑杆）：宽度与左侧偏移交给 CSS（`.is-stacked .resume-font-select`），
      // 因为要对齐的是滑杆的像素位置，而不是"把剩余宽度吃掉"。
      // 2026-10-24 收窄（用户截图："下拉栏太宽"）：176/140 → 152/128。选中态本来就只显示
      // 短名（`SYSTEM_FONT_SHORT_LABEL`），宽度再大也只是把箭头推到很远的地方。
      style={alignWithSlider ? undefined : { width: compact ? 128 : 152 }}
      // 弹层**不**跟着触发框，也**不**按内容撑开（2026-11-06 用户截图：长字体名把弹层
      // 拉到半屏，甚至被窗口右缘裁掉）。宽度由 `.resume-params-dropdown` 定在 216px，
      // 选项文字单行省略、悬停看全称（见 `optionRender`）。
      popupMatchSelectWidth={false}
      classNames={{ popup: { root: "resume-params-dropdown" } }}
      // 选中态用短名（见 `SYSTEM_FONT_SHORT_LABEL`）：这一格与页边距滑杆同宽 200px，
      // 全称必然被截成「系统字体（不使用自定义…」。展开的列表与 title 仍是完整说明。
      labelRender={(props) =>
        props.value === SYSTEM_FONT_VALUE ? SYSTEM_FONT_SHORT_LABEL : props.label
      }
      onOpenChange={(next) => {
        // 点"去下载"引起的那次关闭不算：把弹层按回去，进度就在这一行里走。
        if (!next && keepOpenRef.current) {
          keepOpenRef.current = false;
          setOpen(true);
          return;
        }
        setOpen(next);
      }}
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
            option.data.display &&
            option.data.fileName &&
            option.data.display !== option.data.fileName
              ? `${option.data.display} · ${option.data.fileName}`
              : undefined
          }
        >
          {/* 展示名单独一层：它才是用户认字体的依据（文件名只在 title 里）。 */}
          <span className="resume-font-option-name">{option.data.label}</span>
          {option.data.builtin ? builtinNote() : null}
        </span>
      )}
      onChange={(next: string) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen?.builtin) {
          // 未下载的内置字体：这一下是"去下载"，**不写** format_config——
          // 等真的下完了再写成这份简历的字体（`handleDownloaded`）。
          startBuiltin();
          return;
        }
        // `__system__` 也写成值（不删键）：删键 = "跟随设备当前字体"，是另一种语义。
        onChange({ ...layout, format_config: { ...layout.format_config, font: next } });
      }}
    />
  );
}
