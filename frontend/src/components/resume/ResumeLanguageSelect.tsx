// SPDX-License-Identifier: Apache-2.0
/**
 * 简历语言选择（F-11）：选**纸面固定文案**用哪种语言。
 *
 * 它改的不是"这份简历写了什么"，而是导出文件里印的小节标题与字段名（`Education` /
 * `Skills` / `Objective`…）用哪套词。正文由用户自己写，一个字都不翻译——这一点必须
 * 由旁边的提示讲清（`ResumeTemplateControls` 里的 Tooltip），否则用户选了 English
 * 却发现内容是中文，会以为功能坏了。
 *
 * ## 文案全部走 `t()`，本文件零中文字面量
 *
 * 存量中文的棘轮基线（`src/i18n/cjkRatchet`）只允许下降，所以新增组件一律从语言包取词，
 * 不为它开口子。选项标签直接由语言值拼 key（`resume.language.${language}`），
 * key 与 `ResumeLanguage` 的取值一一对应，加一种语言只需补语言包与类型。
 *
 * ## 为什么不是 `Segmented`
 *
 * 「中文 / English」两者的宽度差异大，Segmented 会把窄的那个拉成等宽、看起来像被选中
 * 了两次；下拉在版式栏这种密集的工具条里也更省横向空间（这一行已经有页数、字号）。
 */
import { Select } from "antd";
import { useI18n } from "../../i18n/I18nProvider";
import type { ResumeLanguage } from "../../types";

/**
 * 可选的语言，顺序即下拉里的顺序。
 *
 * 刻意用数组而不是从对象键里取：顺序是界面的一部分（中文在前），不该被对象的键序
 * 或将来某个 `Record` 的字面量顺序悄悄改掉。
 */
const RESUME_LANGUAGE_VALUES: readonly ResumeLanguage[] = ["zh-CN", "en-US"];

interface Props {
  /** 当前值。**必填**：调用方自己决定 `undefined` 时显示什么（通常是记录的语言）。 */
  value: ResumeLanguage;
  /** 用户选定后回调。 */
  onChange: (language: ResumeLanguage) => void;
  /** 渲染中 / 只读时禁用。 */
  disabled?: boolean;
}

export default function ResumeLanguageSelect({ value, onChange, disabled = false }: Props) {
  const { t } = useI18n();

  return (
    <Select<ResumeLanguage>
      size="small"
      // 触发框宽度只够放下「中文 / English」：与同一行的「最大篇幅」段控保持疏密一致。
      style={{ minWidth: 92 }}
      // 展开后的列表按内容撑开，不跟着触发框一起挤。
      popupMatchSelectWidth={false}
      value={value}
      disabled={disabled}
      // 无障碍名：视觉上的分组标签由宿主渲染，读屏软件需要一个能念出来的名字。
      aria-label={t("resume.language.label")}
      options={RESUME_LANGUAGE_VALUES.map((language) => ({
        value: language,
        label: t(`resume.language.${language}`),
      }))}
      onChange={(next: ResumeLanguage) => onChange(next)}
    />
  );
}
