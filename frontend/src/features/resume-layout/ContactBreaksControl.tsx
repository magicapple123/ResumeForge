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
import { Select, Space, Tooltip, Typography } from "antd";
import { useI18n } from "../../i18n/i18nContext";
import type { MessageKey } from "../../i18n";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import {
  CONTACT_FIELD_KEYS,
  readContactBreaks,
  withContactBreaks,
  type ContactFieldKey,
} from "./contactBreaks";

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
  const options = CONTACT_FIELD_KEYS.map((key) => ({
    value: key,
    label: t(FIELD_LABEL_KEYS[key]),
  }));

  return (
    <Space size={6}>
      {!compact && (
        <Typography.Text type="secondary">{t("workbench.contactBreak.label")}</Typography.Text>
      )}
      <Tooltip title={t("workbench.contactBreak.hint")}>
        {/* 包一层 span：禁用态的下拉不接收指针事件，Tooltip 只能挂在外层。
            宽度是#3 用户反馈的直接修复：不设宽度时 antd Select 会缩到内容宽（实测 34px），
            弹层选项跟着变成一条缝——用户既看不清选了什么，也点不准要选哪个字段。
            260px 够放下两个已选标签与最长选项「出生年份」；maxWidth 100% 让窄屏
            （两栏/单栏制作台、主预览工具栏）按容器收窄，不撑出横向滚动。 */}
        <span style={{ display: "inline-block", width: 260, maxWidth: "100%" }}>
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
        </span>
      </Tooltip>
    </Space>
  );
}
