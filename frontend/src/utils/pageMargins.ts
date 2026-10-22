// SPDX-License-Identifier: Apache-2.0
/**
 * 四向页边距 + 照片大小：键名、区间、解析与写入的**唯一**实现（前端侧）。
 *
 * 为什么单独成文件（与 `utils/pagePadding.ts` 同一理由）：这些键与区间必须与后端
 * `backend/app/services/resume/resume_layout_overrides.py` **逐字一致**。两边不一致的表现是
 * "设了上边距 8mm，导出还是 12mm"（越界值被后端白名单整条丢弃）——最难被发现的一类失败。
 * 所以区间常量在这里只有一处定义，`MIN/MAX` 直接由 `pagePadding.ts` 派生（"四条支路与
 * `page_padding` 同区间"这条设计约束因此是**编译期**成立的，而不是注释里的承诺）。
 *
 * ## 语义（与 §2.2 的优先级逐条对齐）
 *
 * ```
 * 总 = page_padding ： legacy_margin_mm（clamp） ： 模板 padding_mm
 * 四边 = 支路 > 总 > 模板默认
 * 支路不足四条且没有"总" → 整组作废（等价于"没设过"）
 * ```
 *
 * 这一条"整组作废"是 HTML（不知道模板默认值）与 PDF（知道）在同一输入下不出现分歧的
 * 唯一保证，所以前端解析也照抄，不做"更聪明"的补齐。
 *
 * ## 越界行为是**故意不对称**的（§2.5）
 *
 * - 前端（本文件）：**夹紧**——滑杆不该产出非法值，`0.1mm` / `2%` 收口顺带干掉浮点尾巴；
 * - 后端白名单：**丢弃**——与 `page_padding` 及 `test_format_config_is_whitelisted` 同一条
 *   既有契约："非法输入不进入 CSS / 渲染"。
 *
 * 解析（`resolvePageMargins`）刻意**不夹紧** `page_padding` 与模板默认值：它在复刻后端
 * `_resolve_side_values` 的判定，多加一次夹紧就会出现"前端说 26、后端按 30 排"的分叉。
 * 夹紧只发生在**写入**（`with*`）与**上屏**（控件里的 `clampPageMargin`）两处。
 */
import type { ResumeFormatConfig } from "../types/resumeFormat";
import { MAX_PAGE_PADDING, MIN_PAGE_PADDING, clampPagePadding } from "./pagePadding";

/** 四个方向的书写顺序 = CSS `padding` 简写顺序（上右下左）。解析、CSS、控件排列共用它。 */
export const MARGIN_SIDES = ["top", "right", "bottom", "left"] as const;

/** 一个方向。 */
export type MarginSide = (typeof MARGIN_SIDES)[number];

/** 四边的毫米值。 */
export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 方向 → `format_config` 键名（与后端 `PAGE_MARGIN_KEYS` 逐字一致）。 */
export const PAGE_MARGIN_KEY: Record<MarginSide, string> = {
  top: "page_padding_top",
  right: "page_padding_right",
  bottom: "page_padding_bottom",
  left: "page_padding_left",
};

/** "总"滑杆的历史键名：语义已降级为"四边的默认值来源"，键名保持不变。 */
export const PAGE_PADDING_KEY = "page_padding";

/**
 * 单边的取值区间：**就是** `page_padding` 的区间（0–26mm）。
 *
 * 派生而不是各写一份：设计 §9 ② 明确"四条支路共用同一区间，不引入和约束"，派生之后
 * 哪天 `page_padding` 区间变了，四条支路自动跟着变，不会出现两套边界。
 */
export const MIN_PAGE_MARGIN = MIN_PAGE_PADDING;
/** 见 `MIN_PAGE_MARGIN`。 */
export const MAX_PAGE_MARGIN = MAX_PAGE_PADDING;
/** 单边的步长：与后端 `PAGE_MARGIN_STEP` 一致（0.1mm，与 `page_padding` 同精度）。 */
export const PAGE_MARGIN_STEP = 0.1;

/** 照片系数键名（与后端 `PHOTO_SCALE_KEY` 逐字一致）。 */
export const PHOTO_SCALE_KEY = "photo_scale";
/** 照片系数下限：0.6 时经典模板照片约 14×18mm，还认得出脸。 */
export const MIN_PHOTO_SCALE = 0.6;
/** 照片系数上限：1.6 时约 37×48mm，页头仍远宽裕（正文宽最少 158mm）。 */
export const MAX_PHOTO_SCALE = 1.6;
/** 照片系数步长：与后端 `PHOTO_SCALE_STEP` 一致（UI 层是整数百分比，步进 2%）。 */
export const PHOTO_SCALE_STEP = 0.02;
/** "没设过"时照片就是模板原尺寸。 */
export const DEFAULT_PHOTO_SCALE = 1;

/** 目录未下发 `padding_mm` 时的兜底（经典模板的 14mm，也是历史默认）。 */
export const FALLBACK_TEMPLATE_PAGE_PADDING = 14;

/**
 * 解析层接受的配置形状。
 *
 * 用 `Record<string, unknown>` 而不是 `ResumeFormatConfig`：解析要能吃"没校验过的旧数据"
 * （`page_padding` 可能是 `"14"` 这种字符串），畸形值一律按"这个键没设过"处理——把
 * 类型收窄成"只可能是数字"会让调用方到处写 `as`，反而更容易漏掉真问题。
 */
export type MarginConfigLike = Record<string, unknown> | null | undefined;

/** 浮点比较的一次性容差：滑杆步长 0.1 / 0.02，序列化后可能出现 1.1500000000000001。 */
const EPSILON = 1e-9;

/**
 * 把任意配置值读成有限数字；读不出（`null` / 空串 / 非数字 / `NaN`）返回 `null`。
 *
 * 与后端 `_as_float` 同一条收口语义：一个畸形值应当表现为"这个键没设过"，
 * 而不是把 `NaN` 带进 CSS 或渲染器。
 */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 读一个键（配置可能是 `null`）。 */
function readNumber(config: MarginConfigLike, key: string): number | null {
  if (!config) return null;
  return asNumber(config[key]);
}

/**
 * 复制成可写对象（不改原对象）。
 *
 * 逐键复制而不是 `{ ...config }`：解析层接受 `Record<string, unknown>`（要吃没校验过的旧
 * 数据），而写入层产出的是 `ResumeFormatConfig`（`number | string | string[]`）。逐键按
 * 联合类型收口，两个形状之间就不需要 `as`——顺带保证"畸形值不会被原样写回"：
 * 一个 `page_padding: "abc"` 在读的时候已经按"没设过"处理，不该再被复制进去。
 */
function cloneConfig(config: MarginConfigLike): ResumeFormatConfig {
  const next: ResumeFormatConfig = {};
  if (!config) return next;
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" || typeof value === "number") {
      next[key] = value;
    } else if (Array.isArray(value)) {
      // `section_order` 是唯一的数组键（字符串列表）；混进去的非字符串一律丢弃。
      next[key] = value.filter((item): item is string => typeof item === "string");
    }
  }
  return next;
}

/** 删掉四条支路（原地改传入的副本）。 */
function deleteMarginSides(config: ResumeFormatConfig): void {
  for (const side of MARGIN_SIDES) delete config[PAGE_MARGIN_KEY[side]];
}

/**
 * 把任意数字收进 `[0, 26]` 并收口到 **0.1mm**；`NaN` / 非有限值回落到下限。
 *
 * 直接复用 `clampPagePadding`：区间与精度本来就是同一件事，两处各写一遍迟早会漂。
 */
export function clampPageMargin(value: number): number {
  return clampPagePadding(value);
}

/**
 * 按 §2.2 ① 取"总"值：`page_padding`（原值）→ `legacyMargin`（夹紧）→ 模板默认。
 *
 * `page_padding` 不夹紧的理由见文件头：这里在复刻后端的判定，夹紧只发生在写入与上屏。
 */
export function masterPageMargin(
  config: MarginConfigLike,
  templatePadding: number = FALLBACK_TEMPLATE_PAGE_PADDING,
  legacyMargin: number | null = null,
): number {
  const explicit = readNumber(config, PAGE_PADDING_KEY);
  if (explicit !== null) return explicit;
  if (legacyMargin !== null && Number.isFinite(legacyMargin)) return clampPageMargin(legacyMargin);
  return Number.isFinite(templatePadding) ? templatePadding : FALLBACK_TEMPLATE_PAGE_PADDING;
}

/**
 * 按 §2.2 ②③ 解析四边；"一条支路都没有且没有总"或"支路不全且没有总"返回 `null`。
 *
 * `null` 的语义是**"模板 CSS 权威"**（后端 `_resolve_side_values` 的同一出口）。
 */
function resolveSideValues(config: MarginConfigLike): PageMargins | null {
  const numbers: Record<MarginSide, number | null> = {
    top: readNumber(config, PAGE_MARGIN_KEY.top),
    right: readNumber(config, PAGE_MARGIN_KEY.right),
    bottom: readNumber(config, PAGE_MARGIN_KEY.bottom),
    left: readNumber(config, PAGE_MARGIN_KEY.left),
  };
  const provided = MARGIN_SIDES.filter((side) => numbers[side] !== null).length;
  const master = readNumber(config, PAGE_PADDING_KEY);

  if (provided === 0) {
    // ③ 一条支路都没有：四边跟"总"走；连"总"都没有 → 模板 CSS 权威。
    if (master === null) return null;
    return { top: master, right: master, bottom: master, left: master };
  }
  if (master !== null) {
    // ② 支路覆盖"总"，缺的边跟"总"走。
    return {
      top: numbers.top ?? master,
      right: numbers.right ?? master,
      bottom: numbers.bottom ?? master,
      left: numbers.left ?? master,
    };
  }
  if (
    numbers.top === null ||
    numbers.right === null ||
    numbers.bottom === null ||
    numbers.left === null
  ) {
    // ③ "不完整支路"兜底：只有手工请求会撞上（前端永远写全四条）。
    return null;
  }
  // ④ 只有四条支路、没有"总"：四边就是它们（总滑杆读数显示「自定义」）。
  return { top: numbers.top, right: numbers.right, bottom: numbers.bottom, left: numbers.left };
}

/**
 * 解析"这份简历最终四边各是多少毫米"。
 *
 * 与后端 `resolve_page_margins` 一一对应（同一个 `master` 口径、同一条"整组作废"规则），
 * 所以预览里的读数、探针 CSS 与最终导出说的是同一件事。
 *
 * @param config 已过白名单（或原始）的 `format_config`。
 * @param templatePadding 模板自带的 `padding_mm`，四边的最终兜底值。
 * @param legacyMargin 历史旋钮 `margin_mm`：只在没有 `page_padding` 时作回落（旧客户端兼容）。
 */
export function resolvePageMargins(
  config: MarginConfigLike,
  templatePadding: number = FALLBACK_TEMPLATE_PAGE_PADDING,
  legacyMargin: number | null = null,
): PageMargins {
  const master = masterPageMargin(config, templatePadding, legacyMargin);
  const sides = resolveSideValues(config);
  if (sides === null) return { top: master, right: master, bottom: master, left: master };
  return sides;
}

/** 四边是否完全相等（与后端 `len(set(sides.values())) == 1` 同一判据，精确比较）。 */
export function marginsAreUniform(margins: PageMargins): boolean {
  return (
    margins.top === margins.right &&
    margins.right === margins.bottom &&
    margins.bottom === margins.left
  );
}

/**
 * 把一次解析结果写进 `format_config`，维持 §2.2 的**规范化不变式**：
 *
 * > 任何一次写入之后，`format_config` 里**要么**只有 `page_padding`、
 * > **要么**四条支路齐全且不全相等。
 *
 * 这条不变式让后端 99.9% 的情况走两条简单分支（"整组作废"只是安全网）。
 */
function writeMargins(config: MarginConfigLike, margins: PageMargins): ResumeFormatConfig {
  const next = cloneConfig(config);
  deleteMarginSides(next);
  if (marginsAreUniform(margins)) {
    // 四边相等 → 塌回"总"，四条支路一条不留：CSS 因此回到单值形态（与历史产物逐字一致）。
    delete next[PAGE_PADDING_KEY];
    return { ...next, [PAGE_PADDING_KEY]: margins.top };
  }
  for (const side of MARGIN_SIDES) next[PAGE_MARGIN_KEY[side]] = margins[side];
  delete next[PAGE_PADDING_KEY];
  return next;
}

/**
 * 拖某一条边：写全四条（值 = 当前解析结果，其中一条换成新值）。
 *
 * 若换完之后四边恰好全等 → 塌回 `page_padding` 并删掉四条支路（"拖一下就从自定义回到
 * 统一"这个回程就是这么来的，不需要用户再去动总滑杆）。
 *
 * @param config 当前 `format_config`。
 * @param side 目标方向。
 * @param value 新值（mm），会夹紧到 `[0, 26]` 并收口到 0.1mm。
 * @param templatePadding 模板默认值（解析缺的边时用）。
 * @param legacyMargin 历史旋钮（同上）。
 */
export function withMarginSide(
  config: MarginConfigLike,
  side: MarginSide,
  value: number,
  templatePadding: number = FALLBACK_TEMPLATE_PAGE_PADDING,
  legacyMargin: number | null = null,
): ResumeFormatConfig {
  const margins = resolvePageMargins(config, templatePadding, legacyMargin);
  margins[side] = clampPageMargin(value);
  return writeMargins(config, margins);
}

/**
 * 拖总滑杆：写 `page_padding` 并**删掉四条支路** → 四边一起变（需求 d 的唯一入口）。
 *
 * 这一条"清空"是设计 §9 明确拍板的行为：可逆（再分边调一遍即可），而"总滑杆点了没反应"
 * 是不可逆的困惑。
 *
 * @param value 目标页边距（mm）；传 `null` = **全清**（`page_padding` 与四条支路都不留），
 *   也就是"回到随模板"——双击总滑杆标题走的正是这一支。
 */
export function withUniformMargin(
  config: MarginConfigLike,
  value: number | null,
): ResumeFormatConfig {
  const next = cloneConfig(config);
  deleteMarginSides(next);
  delete next[PAGE_PADDING_KEY];
  if (value === null) return next;
  return { ...next, [PAGE_PADDING_KEY]: clampPagePadding(value) };
}

/**
 * 单边复位：该边回到"总"值（没有总则回模板默认）。
 *
 * 三种落点（§5.5 联动表后两行）：
 * 1. 复位后四边全等且等于**模板默认** → 连"总"一起清掉，回到"随模板"；
 * 2. 复位后四边全等 → 塌回 `page_padding`；
 * 3. 复位后仍不全等 → 写全四条（该边是最新解析出的"总"值，其余三条不变）。
 */
export function withResetMarginSide(
  config: MarginConfigLike,
  side: MarginSide,
  templatePadding: number = FALLBACK_TEMPLATE_PAGE_PADDING,
  legacyMargin: number | null = null,
): ResumeFormatConfig {
  const margins = resolvePageMargins(config, templatePadding, legacyMargin);
  margins[side] = masterPageMargin(config, templatePadding, legacyMargin);

  if (marginsAreUniform(margins)) {
    const templateValue = Number.isFinite(templatePadding)
      ? templatePadding
      : FALLBACK_TEMPLATE_PAGE_PADDING;
    if (Math.abs(margins.top - templateValue) <= EPSILON) {
      // ① 回到"随模板"：四条支路与"总"都不留，模板以后改默认值时这份简历才会跟着变。
      const next = cloneConfig(config);
      deleteMarginSides(next);
      delete next[PAGE_PADDING_KEY];
      return next;
    }
  }
  return writeMargins(config, margins);
}

/**
 * 把照片系数收进 `[0.6, 1.6]` 并收口到 **2 位小数**；非有限值回落到 1.0（= 模板原尺寸）。
 *
 * 为什么是"收口到 2 位小数"而不是"量化到 2% 网格"：后端白名单只校验区间、不量化
 * （`validated_format_config` 里是 `round(number, 3)`），所以 `1.15` 是一个**合法**输入
 * （设计 §8.2 就拿它当例子）。把它量化到 1.14 会让探针说 114%、真实渲染画 115%——
 * 正是"松手后跳一下"那种最难解释的偏差。滑杆的 2% 步长只是 UI 手感，不该成为存储口径。
 */
export function clampPhotoScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PHOTO_SCALE;
  const clamped = Math.min(MAX_PHOTO_SCALE, Math.max(MIN_PHOTO_SCALE, value));
  return Math.round(clamped * 100) / 100;
}

/**
 * 解析照片系数：缺键 = `1.0`（与后端 `resolve_photo_scale` 一致），越界值夹紧。
 *
 * 注意它与页边距解析的差别：这里**夹紧**。原因是后端对 `photo_scale` 的越界值是"丢弃"
 * （退回 1.0），而 1.0 与夹紧到 1.6 的视觉差别巨大；前端夹紧保证"用户拖到哪就画到哪"，
 * 且 UI 永远写不出越界值，两者在合法输入上完全等价。
 */
export function resolvePhotoScale(config: MarginConfigLike): number {
  const raw = readNumber(config, PHOTO_SCALE_KEY);
  if (raw === null) return DEFAULT_PHOTO_SCALE;
  return clampPhotoScale(raw);
}

/** 系数 → 界面上的整数百分比（`1.15 → 115`）。UI 层只碰百分比，落库才 `/100`。 */
export function toPhotoPercent(scale: number): number {
  return Math.round(clampPhotoScale(scale) * 100);
}

/** 界面上的整数百分比 → 系数（`115 → 1.15`），会夹紧到 `[60, 160]`。 */
export function fromPhotoPercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_PHOTO_SCALE;
  return clampPhotoScale(percent / 100);
}

/**
 * 写照片系数：`null` = 删键（回到 100% 随模板），数字 = 按百分比写入。
 *
 * 删键而不是写回 1.0：与行距/页边距同一语义——存储里"没调过"只有一种形态，
 * 以后模板若要改默认照片策略，这些简历才跟着变。
 */
export function withPhotoScale(
  config: MarginConfigLike,
  percent: number | null,
): ResumeFormatConfig {
  const next = cloneConfig(config);
  delete next[PHOTO_SCALE_KEY];
  if (percent === null) return next;
  return { ...next, [PHOTO_SCALE_KEY]: fromPhotoPercent(percent) };
}

// ===== 读取侧：控件需要知道"这个键设过没有"（不复用解析结果的形状） =====

/**
 * 某个方向自己的值（没设过 → `null`）。
 *
 * 与 `resolvePageMargins` 的区别：那个回答"最终落在纸面上是多少"，这个只回答"这一条支路
 * 有没有被用户碰过"——控件用它决定逐行的「随模板」标签显不显示。
 */
export function configuredMarginSide(config: MarginConfigLike, side: MarginSide): number | null {
  return readNumber(config, PAGE_MARGIN_KEY[side]);
}

/** 用户是否动过页边距（`page_padding` 或任意一条支路）。 */
export function hasMarginOverrides(config: MarginConfigLike): boolean {
  if (readNumber(config, PAGE_PADDING_KEY) !== null) return true;
  return MARGIN_SIDES.some((side) => readNumber(config, PAGE_MARGIN_KEY[side]) !== null);
}

/**
 * 哪些边与"统一值"**不一样**（分边面板据此决定逐行的 ↺ 出不出现）。
 *
 * 为什么不用 `configuredMarginSide`（"这个键写过没有"）：拖一条边时 `withMarginSide`
 * 会把四条一起写全（§2.2 的规范化不变式），于是"写过"的边有四条，而"真的不一样"的
 * 只有一条。用"写过没有"画 ↺，用户拖一次就会看到四个复位图标——正是要消掉的噪声。
 */
export function sidesDifferingFromMaster(
  config: MarginConfigLike,
  templatePadding: number = FALLBACK_TEMPLATE_PAGE_PADDING,
  legacyMargin: number | null = null,
): Record<MarginSide, boolean> {
  const master = masterPageMargin(config, templatePadding, legacyMargin);
  const margins = resolvePageMargins(config, templatePadding, legacyMargin);
  const differs = (value: number) => Math.abs(value - master) > EPSILON;
  return {
    top: differs(margins.top),
    right: differs(margins.right),
    bottom: differs(margins.bottom),
    left: differs(margins.left),
  };
}

/** 用户是否设过照片系数（没设过 → `null`，读数显示「随模板」）。 */
export function configuredPhotoScale(config: MarginConfigLike): number | null {
  return readNumber(config, PHOTO_SCALE_KEY);
}

/** 系数 → 界面百分比。与 `toPhotoPercent` 同义，单独留一个命名是为了让控件读起来像"取显示值"。 */
export function photoScalePercent(scale: number): number {
  return toPhotoPercent(scale);
}
