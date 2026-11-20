// SPDX-License-Identifier: Apache-2.0
/**
 * 草稿模式下的照片参数实时样式（5.4）——**纯函数 + iframe 注入**。
 *
 * ## 为什么需要它
 *
 * 纸面是服务端渲染的 HTML，任何参数改动都要走 `useResumeLivePreview` 的 600ms 合并窗口
 * 再整页重排。拖「圆角」「边框」「偏移」滑块时，画面几乎不动、松手才跳一下。
 * 但这五项在后端只落成两条 CSS（见下），**不重渲染 HTML 也能预览**：把同一份规则注入
 * 草稿 iframe，滑块每动一次就改写一次 `<style>` 的 `textContent`。
 *
 * ## 公式来源（**改任何一边必须改另一边**）
 *
 * 逐字复刻 `backend/app/services/resume/resume_template_format.py` 的 `format_css()`
 * 照片分支（约 :379-400，`if PHOTO_FIELD_KEYS & set(values)` 那一段）与
 * `resume_layout_overrides.photo_scale_css_value`（`:341`）。四条特殊口径一条都不能省：
 *
 * 1. **五项一个都没设过 → 一个字符都不写**（默认 1px / `var(--line)` / 4px 由模板负责）；
 * 2. `photo_border_width <= 0` → `border: 0`（不是 `border-width: 0`）；
 * 3. 颜色缺省 → `border: {w}px solid var(--line)`；
 * 4. 两个偏移都是 0 → **不写** `transform`。
 *
 * 判定"设过"看的是**键在不在**（而不是"值等不等于模板默认"）：显式写
 * `photo_radius: 4` 时后端照样输出整条规则，这里也必须输出——否则松手后规则会消失再
 * 重新出现，就是那一下闪。`resumeFormatProbe.photoFrameProbeCss` 是按值判定的旧探针，
 * 语义不同，不要合并。
 *
 * ## 注入方式与主题染色同构
 *
 * 样式表常驻 iframe 内部、id 固定（`rf-photo-live`）、只注入一次，之后只改文本。
 * 服务端 HTML 回来时 iframe 会重载，所以 `onLoad` 之后必须再写一遍（否则闪回旧值）。
 * 计算在客户端、导出仍走服务端：不变量仍是"预览 = 导出"。
 */
import { formatG } from "../../../utils/resumeFormatProbe";

/** 注入 iframe 的那个 `<style>` 的 id（重复注入靠它判重）。 */
export const PHOTO_LIVE_STYLE_ID = "rf-photo-live";

/** 与后端 `resume_format_groups.PHOTO_FIELD_KEYS` 同五项。 */
export const PHOTO_LIVE_FIELD_KEYS = [
  "photo_border_width",
  "photo_border_color",
  "photo_radius",
  "photo_offset_x",
  "photo_offset_y",
] as const;

/** 与后端 `FORMAT_FIELDS` 的 min/max 一致（改一处必须改两处）。 */
const PHOTO_LIVE_BOUNDS: Record<string, readonly [number, number]> = {
  photo_border_width: [0, 16],
  photo_radius: [0, 48],
  photo_offset_x: [-40, 40],
  photo_offset_y: [-40, 40],
};

/** 照片系数区间（后端 `PHOTO_SCALE_MIN/MAX`）。 */
const PHOTO_SCALE_MIN = 0.6;
const PHOTO_SCALE_MAX = 1.6;

/** 与后端 `resume_config_domains.HEX_COLOR_RE` 同口径：三位或六位十六进制。 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type Config = Record<string, unknown> | null | undefined;

/**
 * 读一个数字键，按后端 `validated_format_config` 的口径校验：
 * 缺键 / 空串 / 非数字 → `null`（= 这个键"没设过"）；越界夹到边界并保留三位小数。
 */
function readBoundedNumber(config: Config, key: string): number | null {
  const raw = config?.[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  const [low, high] = PHOTO_LIVE_BOUNDS[key];
  return Math.round(Math.min(high, Math.max(low, value)) * 1000) / 1000;
}

/** 读颜色键：只认六位十六进制，小写化（与后端 `text.lower()` 一致）。 */
function readHexColor(config: Config): string | null {
  const raw = config?.photo_border_color;
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  return HEX_COLOR.test(text) ? text.toLowerCase() : null;
}

/** 照片系数：缺键 = 1；越界夹紧、保留三位小数。等于 1 时返回 `null`（一个字符都不写）。 */
export function photoScaleLiveValue(config: Config): string | null {
  const raw = config?.photo_scale;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  const clamped = Math.min(PHOTO_SCALE_MAX, Math.max(PHOTO_SCALE_MIN, value));
  const rounded = Math.round(clamped * 1000) / 1000;
  if (Math.abs(rounded - 1) <= 1e-9) return null;
  return formatG(rounded);
}

/**
 * `.profile-photo { … }` 那一条规则；五项都没设过时返回空串。
 *
 * 声明顺序（`border` → `border-radius` → `transform`）与分隔符（`"; "`）都不能动：
 * 后端用同一个模板字符串拼出同一条规则，顺序不同就是"拖动中"与"松手后"两份产物。
 */
export function photoFrameLiveRule(config: Config): string {
  const width = readBoundedNumber(config, "photo_border_width");
  const radius = readBoundedNumber(config, "photo_radius");
  const offsetX = readBoundedNumber(config, "photo_offset_x");
  const offsetY = readBoundedNumber(config, "photo_offset_y");
  const color = readHexColor(config);
  // 规则 1：五项全部"没设过"（键缺失 / 值非法）→ 一个字都不写。
  if (width === null && radius === null && offsetX === null && offsetY === null && !color) {
    return "";
  }
  const declarations = [`border-radius: ${formatG(radius ?? 4)}px`];
  const borderWidth = width ?? 1;
  if (borderWidth <= 0) declarations.unshift("border: 0");
  else if (color) declarations.unshift(`border: ${formatG(borderWidth)}px solid ${color}`);
  else declarations.unshift(`border: ${formatG(borderWidth)}px solid var(--line)`);
  const x = offsetX ?? 0;
  const y = offsetY ?? 0;
  if (x !== 0 || y !== 0) {
    declarations.push(`transform: translate(${formatG(x)}mm, ${formatG(y)}mm)`);
  }
  return `.profile-photo { ${declarations.join("; ")} }`;
}

/**
 * 当前（未保存的）`format_config` → 注入草稿 iframe 的 CSS 片段。
 *
 * 块顺序与后端 `format_css` 一致：`:root` 变量在前、`.profile-photo` 规则在后，
 * 块之间用换行分隔（`blocks` → `"\n".join`）。没有任何照片参数时返回空串。
 */
export function buildPhotoLiveCss(config: Config): string {
  const blocks: string[] = [];
  const scale = photoScaleLiveValue(config);
  if (scale !== null) blocks.push(`:root { --photo-scale: ${scale}; }`);
  const frame = photoFrameLiveRule(config);
  if (frame) blocks.push(frame);
  return blocks.join("\n");
}

/**
 * 把一个 iframe 文档刷成给定的照片样式。
 *
 * 样式表**只注入一次**，之后只改 `textContent`（与 `paintPaperTheme` 同一套做法）：
 * 反复增删节点会让 iframe 每次都重新计算样式，拖动时看得见闪。
 */
export function paintPhotoLiveStyle(doc: Document | null, css: string): void {
  if (!doc?.documentElement) return;
  let style = doc.getElementById(PHOTO_LIVE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    // 空串时不建节点：与后端"一个字符都不写"保持一致。
    if (!css) return;
    style = doc.createElement("style");
    style.id = PHOTO_LIVE_STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

/**
 * 把视口里**已经加载好**的每个 iframe 刷成当前照片样式。
 *
 * 文档会随 `srcDoc` 重载被换掉，因此每次都从容器上现场找 iframe，不记住文档引用。
 */
export function paintLoadedPhotoLiveFrames(container: HTMLElement | null, css: string): void {
  if (!container) return;
  for (const frame of Array.from(container.querySelectorAll("iframe"))) {
    paintPhotoLiveStyle(frame.contentDocument, css);
  }
}
