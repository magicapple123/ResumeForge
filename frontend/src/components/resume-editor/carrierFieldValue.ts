// SPDX-License-Identifier: Apache-2.0
/**
 * 承载区「标签：值」行的读写（需求 #5：系统板块自定义字段的输入框）。
 *
 * ## 为什么值不另存一份
 *
 * 纸面投影（`paper_content_builder._build_entry`）对「没有独立槽位的字段」（自定义字段、
 * 以及默认字段里没槽位/枚举不认识的那些）只有一种落法：在该条目的**承载区**（projects →
 * `description`、educations → `achievements`、skills → `level`、publications → `note` …）
 * 末尾追加一行 `标签：值`。所以编辑器里这个字段的输入框必须**直接读写承载区那一行**：
 *
 * - 值只存一处 → 保存/再次保存都不会多出一行（不存在「表单一份 + 纸面一份」的二次追加）；
 * - 不动 ResumeContent 结构、不迁移数据库；
 * - 纸面、导出、AI 生成后处理（C5-B 补回同一行）看到的还是同一个字符串。
 *
 * ## 匹配口径
 *
 * 只认「行首就是标签 + 冒号」：半角/全角冒号、冒号前后空白都接受（AI 改写常产出
 * `导师姓名: 张伟`），因此同一语义的行会被**归一**成投影使用的全角格式 `标签：值`。
 * 标签是另一个标签的前缀时（`导师` vs `导师姓名`）不会误命中，因为中间不是冒号。
 * 手写行与此同义：它就是同一个值的另一种写法，改写格式不算丢内容。
 */

/** 一条「标签：值」行里属于 label 的值；不是这个 label 的行返回 null。 */
export function carrierLineValue(line: string, label: string): string | null {
  if (!label) return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith(label)) return null;
  const rest = trimmed.slice(label.length);
  // i18n-ok: 全角冒号是后端纸面投影「标签：值」格式的协议字符，不能进语言包
  const separator = /^\s*[:：]\s*/.exec(rest);
  if (!separator) return null;
  return rest.slice(separator[0].length);
}

function linesOf(carrier: unknown): string[] {
  if (Array.isArray(carrier)) return carrier.map((item) => String(item ?? ""));
  if (typeof carrier === "string") return carrier.split(/\r?\n/);
  return [];
}

/** 从承载区读字段值；没有该行（或承载区为空）返回空串。 */
export function readCarrierField(carrier: unknown, label: string): string {
  for (const line of linesOf(carrier)) {
    const value = carrierLineValue(line, label);
    if (value !== null) return value;
  }
  return "";
}

/**
 * 把字段值写回承载区（返回新值，不修改入参）：
 * - 空值 → 删除该标签行（与纸面投影一致：投影只为「有值」的字段追加行）；
 * - 已有行 → 原位替换，并归一成全角冒号格式；
 * - 重复行 → 合并成一行（历史数据/手写里的重复不该越存越多）；
 * - 没有行 → 追加到末尾（与纸面 extras 的追加顺序同口径）。
 *
 * `isList` 只在承载区当前值缺失时用来决定产出类型（数组 or 标量字符串）。
 */
export function writeCarrierField(
  carrier: unknown,
  label: string,
  nextValue: string,
  isList: boolean,
): string | string[] {
  const value = nextValue.trim();
  const result: string[] = [];
  let written = false;
  for (const line of linesOf(carrier)) {
    if (carrierLineValue(line, label) === null) {
      result.push(line);
      continue;
    }
    if (!written && value) {
      // i18n-ok: 与后端纸面投影的「标签：值」逐字一致，协议字符不能进语言包
      result.push(`${label}：${value}`);
      written = true;
    }
  }
  // i18n-ok: 同上（「标签：值」是纸面协议格式）
  if (value && !written) result.push(`${label}：${value}`);
  const asList = Array.isArray(carrier) || (carrier === undefined && isList);
  return asList ? result : result.join("\n");
}
