// SPDX-License-Identifier: Apache-2.0
/**
 * 自定义搜索来源的字段（CR-09）。
 *
 * 两套模板：`moonshot` 只差一个根地址；`generic` 还要端点与字段映射。字段留空一律
 * "用模板默认值"，所以模板切换不会把用户填过的值清掉。
 *
 * 校验分两层：保存时后端会 422（相对路径 / 公网地址 / 字段语法），这里只做**提示性**
 * 的即时反馈（地址不是 http(s) 时给一句），不在前端复制一份完整规则——两套规则迟早分叉。
 */

import { Flex, Input, Segmented, Switch, Typography } from "antd";
import type { CustomSearchTemplate, SearchConfig } from "../../types";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import SettingsField from "./SettingsField";

const TEMPLATE_OPTIONS: { value: CustomSearchTemplate; labelKey: MessageKey }[] = [
  { value: "moonshot", labelKey: "searchCard.custom.templateMoonshot" },
  { value: "generic", labelKey: "searchCard.custom.templateGeneric" },
];

export default function SearchCustomFields({
  config,
  onChange,
}: {
  config: SearchConfig;
  onChange: (changes: Partial<SearchConfig>) => void;
}) {
  // 模块级 t()：必须订阅语言变化，否则切语言后这块不重渲染（i18n 有自动守卫）。
  useLocale();
  return (
    <Flex vertical gap={8}>
      <SettingsField label={t("searchCard.custom.template")}>
        <Segmented<CustomSearchTemplate>
          value={config.custom_template}
          onChange={(value) => onChange({ custom_template: value })}
          options={TEMPLATE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
      </SettingsField>

      <Input
        aria-label={t("searchCard.custom.baseUrlAria")}
        value={config.custom_base_url}
        onChange={(event) => onChange({ custom_base_url: event.target.value })}
        placeholder={t("searchCard.custom.baseUrlPlaceholder")}
        allowClear
        autoComplete="off"
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("searchCard.custom.baseUrlHint")}
      </Typography.Text>

      <Input.Password
        aria-label={t("searchCard.custom.keyAria")}
        value={config.custom_api_key}
        onChange={(event) => onChange({ custom_api_key: event.target.value })}
        placeholder={t("searchCard.custom.keyPlaceholder")}
        allowClear
        autoComplete="off"
      />

      {config.custom_template === "generic" ? (
        <>
          <Input
            aria-label={t("searchCard.custom.searchPathAria")}
            value={config.custom_search_path}
            onChange={(event) => onChange({ custom_search_path: event.target.value })}
            placeholder={t("searchCard.custom.searchPathPlaceholder")}
            allowClear
            autoComplete="off"
          />
          <Input
            aria-label={t("searchCard.custom.fetchPathAria")}
            value={config.custom_fetch_path}
            onChange={(event) => onChange({ custom_fetch_path: event.target.value })}
            placeholder={t("searchCard.custom.fetchPathPlaceholder")}
            allowClear
            autoComplete="off"
          />
          <Input
            aria-label={t("searchCard.custom.fieldAria")}
            value={config.custom_results_field}
            onChange={(event) => onChange({ custom_results_field: event.target.value })}
            placeholder={t("searchCard.custom.fieldPlaceholder")}
            allowClear
            autoComplete="off"
          />
          <Flex align="center" gap={8}>
            <Switch
              aria-label={t("searchCard.custom.includeContent")}
              checked={config.custom_include_content}
              onChange={(checked) => onChange({ custom_include_content: checked })}
            />
            <Typography.Text>{t("searchCard.custom.includeContent")}</Typography.Text>
          </Flex>
        </>
      ) : null}
    </Flex>
  );
}
