// SPDX-License-Identifier: Apache-2.0
/**
 * 「受控浏览器」选择字段：自动 / Chrome / Edge / 自定义路径 + 自定义路径输入。
 *
 * **投递台与网申填表共用浏览器类型配置，但窗口和登录态彼此隔离**，所以这里的选择也是
 * 同一份——抽成一个组件而不是各写一份，否则两处迟早会分叉成"投递台用 Chrome、网申页却
 * 起了 Edge"这种没人能解释的状态。
 *
 * 用法：放进一个 `<Form>` 里，字段名固定是 `browser_choice` / `browser_path`。
 */
import { Form, Input, Select, Space } from "antd";
import { BROWSER_CHOICE_META, type BrowserChoice } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

const BROWSER_CHOICE_OPTIONS = (Object.keys(BROWSER_CHOICE_META) as BrowserChoice[]).map(
  (value) => ({
    value,
    label: BROWSER_CHOICE_META[value].label,
  }),
);

interface Props {
  /** 文案可按场景微调（投递台 / 网申填表），默认写两处都成立的说法。 */
  label?: string;
  /** 紧凑档（网申填表弹窗用）：字段换行排列时行距 16→8，弹窗内不显松散。 */
  compact?: boolean;
}

export default function BrowserChoiceFields({ label, compact = false }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后字段标签停在旧文案。
  useLocale();
  // 只有选了「自定义路径」才需要填路径。
  const browserChoice = Form.useWatch("browser_choice") as BrowserChoice | undefined;
  return (
    <Space size={compact ? 8 : 16} wrap>
      <Form.Item
        name="browser_choice"
        label={label ?? t("applyUi.browserChoice.label")}
        extra={browserChoice ? BROWSER_CHOICE_META[browserChoice]?.hint : undefined}
      >
        <Select options={BROWSER_CHOICE_OPTIONS} style={{ width: 220 }} />
      </Form.Item>
      <Form.Item
        name="browser_path"
        label={t("applyUi.browserChoice.pathLabel")}
        extra={t("applyUi.browserChoice.pathExtra")}
      >
        <Input
          placeholder={t("applyUi.browserChoice.pathPlaceholder")}
          disabled={browserChoice !== "custom"}
          style={{ width: 320 }}
        />
      </Form.Item>
    </Space>
  );
}
