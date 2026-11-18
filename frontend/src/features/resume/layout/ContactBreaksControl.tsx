// SPDX-License-Identifier: Apache-2.0
/**
 * 排版参数 · 联系方式换行（#3）。
 *
 * 默认行为是"每个联系方式字段整体不拆行、字段之间自动换行"；这个控件让用户挑
 * "在哪个字段前强制换行"（例如把个人主页单独放到第二行）。参数随简历保存
 * （format_config.contact_breaks），HTML 预览 / 精确预览 PDF / Word / HTML 导出
 * 四条链路同一份取值。
 *
 * 字段名复用 editor.field.* 语言包（手机 / 邮箱 / 城市 / 出生年份 / GitHub / 个人主页）：
 * 同一份简历里"编辑字段"与"排联系方式"讲的是同一个东西，不该有两套叫法。
 */
import { Select, Space } from "antd";
import { useI18n } from "../../../i18n/i18nContext";
import type { MessageKey } from "../../../i18n";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import {
  CONTACT_FIELD_KEYS,
  readContactBreaks,
  withContactBreaks,
  type ContactFieldKey,
} from "./contactBreaks";
import HintDetail from "../../../components/common/HintDetail";
import {
  CONTACT_SEPARATOR_STYLES,
  readContactSeparator,
  withContactSeparator,
  type ContactSeparatorStyle,
} from "./contactSeparator";

/** 字段键 → 语言包 key（与 backend resume_contact.CONTACT_FIELDS 顺序一致）。 */
const FIELD_LABEL_KEYS: Record<ContactFieldKey, MessageKey> = {
  phone: "editor.field.phone",
  email: "editor.field.email",
  city: "editor.field.city",
  birth_year: "editor.field.birthYear",
  github: "editor.field.github",
  personal_website: "editor.field.website",
};

interface Props {
  /** 当前版式覆盖（只读 contact_breaks，其余键原样保留）。 */
  formatConfig?: ResumeFormatConfig | null;
  disabled?: boolean;
  /** 紧凑模式：只留控件、不显示分组标签（放进工具栏时用）。 */
  compact?: boolean;
  /** 写回**整个** format_config（空选择会删掉 contact_breaks 键）。 */
  onChange: (next: ResumeFormatConfig) => void;
}

export default function ContactBreaksControl({
  formatConfig,
  disabled = false,
  compact = false,
  onChange,
}: Props) {
  const { t } = useI18n();
  const value = readContactBreaks(formatConfig);
  const separator = readContactSeparator(formatConfig);
  const separatorOptions = CONTACT_SEPARATOR_STYLES.map((style) => ({
    value: style,
    label: t(`contactSeparator.option.${style}`),
  }));
  const options = CONTACT_FIELD_KEYS.map((key) => ({
    value: key,
    label: t(FIELD_LABEL_KEYS[key]),
  }));

  /**
   * 两个下拉本体（紧凑与非紧凑两个分支共用，避免各写一遍选择器配置）。
   *
   * 宽度：紧凑分支由外面的定宽 span 管（104 / 76，工具栏里按内容排即可）；
   * 非紧凑分支交给 `.resume-wb-field-control` + `.resume-wb-field-row .ant-select`
   * （I-06：铺满控件列、封顶 320）。所以这里不写死宽度，只由 `width` 参数决定。
   */
  const buildBreakSelect = () => (
    <Select
      size="small"
      mode="multiple"
      allowClear
      maxTagCount="responsive"
      aria-label={t("workbench.contactBreak.label")}
      placeholder={t("workbench.contactBreak.placeholder")}
      className="resume-contact-break-select"
      style={{ width: "100%" }}
      disabled={disabled || undefined}
      value={value}
      options={options}
      onChange={(next: ContactFieldKey[]) => onChange(withContactBreaks(formatConfig, next))}
    />
  );

  /* `fill` 决定「铺满控件列」还是「保持紧凑工具栏里的 76px」。宽度只写在 `style` 里：
     直接往 JSX 里传 `"100%"` 这种裸字符串会被 `cjkRatchet` 的文案扫描判成"新增产品文案"
     （2026-11-18 实测三条 unregistered product copy），而 `style` 是技术语境、不参与扫描。 */
  const buildSeparatorSelect = (fill = false) => (
    <Select
      size="small"
      aria-label={t("workbench.contactSeparator.label")}
      className="resume-contact-separator-select"
      style={{ width: fill ? "100%" : 76 }}
      disabled={disabled || undefined}
      value={separator}
      options={separatorOptions}
      onChange={(next: ContactSeparatorStyle) => onChange(withContactSeparator(formatConfig, next))}
    />
  );

  const breakHint = (
    <HintDetail
      detail={t("workbench.contactBreak.hint")}
      label={t("workbench.contactBreak.label")}
    />
  );
  const separatorHint = (
    <HintDetail detail={t("contactSeparator.hint")} label={t("workbench.contactSeparator.label")} />
  );

  /* 分隔符与"在哪换行"是两件事，但必须挨在一起：用户改完换行就会想调分隔符。 */
  const control = (
    <>
      <Space size={4} align="center">
        <span style={{ display: "inline-block", width: 104, maxWidth: "100%" }}>
          {buildBreakSelect()}
        </span>
      </Space>
      {breakHint}
    </>
  );
  const separatorControl = (
    <>
      <Space size={4} align="center">
        {buildSeparatorSelect()}
      </Space>
      {separatorHint}
    </>
  );

  // compact 分支（工具栏在用）保持原样：那里没有「版面」组的标签列，多一个标签格会留白。
  if (compact) {
    return (
      <Space size={6}>
        {control}
        {separatorControl}
      </Space>
    );
  }

  /* 任务 4：非 compact 分支进「版面」组的两列网格——控件列与其他四行同一条竖线。
     F26：分隔符不再藏在「联系方式换行」这一行的第二个下拉里，改成独立一行并带可见标签；
     行名只讲换行、下拉又没有标签时，用户会以为"分隔符"这个功能没做。
     I-06：控件包在 `.resume-wb-field-control` 里（控件铺满控件列、ⓘ 固定第二格），
     不再用 `Space`——Space 的子项按内容宽，下拉会一直停在 104px。 */
  return (
    <>
      <div className="resume-wb-field-row">
        <span className="resume-wb-field-label">{t("workbench.contactBreak.label")}</span>
        <span className="resume-wb-field-control">
          {buildBreakSelect()}
          {breakHint}
        </span>
      </div>
      <div className="resume-wb-field-row">
        <span className="resume-wb-field-label">{t("workbench.contactSeparator.label")}</span>
        <span className="resume-wb-field-control">
          {buildSeparatorSelect(true)}
          {separatorHint}
        </span>
      </div>
    </>
  );
}
