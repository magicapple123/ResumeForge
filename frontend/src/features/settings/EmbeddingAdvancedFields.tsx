// SPDX-License-Identifier: Apache-2.0
/** 「远程服务」卡折叠区：自定义端点模板的七个字段（任务书 §4.7 路径 A）。 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Collapse, Flex, Input, InputNumber, Select, Switch, Typography } from "antd";
import type { EmbeddingRemoteConfig } from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  value: EmbeddingRemoteConfig;
  onChange: (patch: Partial<EmbeddingRemoteConfig>) => void;
}

/** 模板与请求头是"高级"：默认收起，不占普通用户的主流程。 */
export default function EmbeddingAdvancedFields({ value, onChange }: Props) {
  useLocale();

  const patchHeader = (index: number, patch: { name?: string; value?: string }) => {
    onChange({
      headers: value.headers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    });
  };

  const removeHeader = (index: number) => {
    onChange({ headers: value.headers.filter((_, rowIndex) => rowIndex !== index) });
  };

  const items = [
    {
      key: "advanced",
      label: t("embeddingSearch.remote.advanced"),
      children: (
        <Flex vertical gap={16}>
          <div>
            <Typography.Text strong>
              {t("embeddingSearch.remote.endpointMode.label")}
            </Typography.Text>
            <Select
              style={{ width: "100%" }}
              aria-label={t("embeddingSearch.remote.endpointMode.label")}
              value={value.endpoint_mode}
              onChange={(mode: EmbeddingRemoteConfig["endpoint_mode"]) =>
                onChange({ endpoint_mode: mode })
              }
              options={[
                {
                  value: "openai",
                  label: t("embeddingSearch.remote.endpointMode.openai"),
                },
                {
                  value: "template",
                  label: t("embeddingSearch.remote.endpointMode.template"),
                },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("embeddingSearch.remote.endpointMode.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text strong>{t("embeddingSearch.remote.requestUrl.label")}</Typography.Text>
            <Input
              aria-label={t("embeddingSearch.remote.requestUrl.label")}
              value={value.request_url}
              placeholder={t("embeddingSearch.remote.requestUrl.placeholder")}
              autoComplete="off"
              onChange={(event) => onChange({ request_url: event.target.value })}
            />
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("embeddingSearch.remote.requestUrl.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text strong>{t("embeddingSearch.remote.headers.label")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 8px" }}>
              {t("embeddingSearch.remote.headers.hint")}
            </Typography.Paragraph>
            <Flex vertical gap={8}>
              {value.headers.map((row, index) => (
                <Flex key={index} gap={8} align="center">
                  <Input
                    aria-label={t("embeddingSearch.remote.headers.namePlaceholder")}
                    value={row.name}
                    placeholder={t("embeddingSearch.remote.headers.namePlaceholder")}
                    autoComplete="off"
                    onChange={(event) => patchHeader(index, { name: event.target.value })}
                  />
                  <Input
                    aria-label={t("embeddingSearch.remote.headers.valuePlaceholder")}
                    value={row.value}
                    placeholder={t("embeddingSearch.remote.headers.valuePlaceholder")}
                    autoComplete="off"
                    onChange={(event) => patchHeader(index, { value: event.target.value })}
                  />
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t("embeddingSearch.remote.headers.remove")}
                    onClick={() => removeHeader(index)}
                  />
                </Flex>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={() => onChange({ headers: [...value.headers, { name: "", value: "" }] })}
              >
                {t("embeddingSearch.remote.headers.add")}
              </Button>
            </Flex>
          </div>

          <div>
            <Typography.Text strong>
              {t("embeddingSearch.remote.bodyTemplate.label")}
            </Typography.Text>
            <Input.TextArea
              aria-label={t("embeddingSearch.remote.bodyTemplate.label")}
              value={value.body_template}
              placeholder={t("embeddingSearch.remote.bodyTemplate.placeholder")}
              rows={3}
              onChange={(event) => onChange({ body_template: event.target.value })}
            />
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("embeddingSearch.remote.bodyTemplate.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text strong>
              {t("embeddingSearch.remote.responsePath.label")}
            </Typography.Text>
            <Input
              aria-label={t("embeddingSearch.remote.responsePath.label")}
              value={value.response_path}
              placeholder={t("embeddingSearch.remote.responsePath.placeholder")}
              autoComplete="off"
              onChange={(event) => onChange({ response_path: event.target.value })}
            />
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("embeddingSearch.remote.responsePath.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text strong>{t("embeddingSearch.remote.batchSize.label")}</Typography.Text>
            <InputNumber
              style={{ width: "100%" }}
              aria-label={t("embeddingSearch.remote.batchSize.label")}
              min={1}
              max={200}
              value={value.batch_size}
              onChange={(next) => onChange({ batch_size: next ?? value.batch_size })}
            />
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("embeddingSearch.remote.batchSize.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Flex align="center" gap={8}>
              <Switch
                aria-label={t("embeddingSearch.remote.allowPrivate.label")}
                checked={value.allow_private}
                onChange={(checked) => onChange({ allow_private: checked })}
              />
              <Typography.Text>{t("embeddingSearch.remote.allowPrivate.label")}</Typography.Text>
            </Flex>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("embeddingSearch.remote.allowPrivate.hint")}
            </Typography.Paragraph>
          </div>
        </Flex>
      ),
    },
  ];

  return <Collapse items={items} />;
}
