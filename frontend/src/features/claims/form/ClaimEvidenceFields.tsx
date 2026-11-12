// SPDX-License-Identifier: Apache-2.0
/**
 * 台账表单的「证据」字段组：关联资料条目（参与生成筛选）+ 证据来源（只做定位）。
 *
 * 两块刻意分开（问题清单 §20.5-3）：
 * - 「关联资料条目」选的是资料库里的 entry_id，"这条主张对应哪段资料"决定它能不能进生成；
 * - 「证据来源」是自由文本（链接 / 文件名），只回答"去哪儿能找到"，不参与筛选。
 * 修复前两者混在同一栏里，用户按提示填 URL、系统却拿它和 24 位 entry_id 比较——基线恒为空。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select, Space, Switch, Typography } from "antd";
import { t } from "../../../i18n";
import { SOURCE_TYPE_LABEL_KEYS } from "../../../i18n/enum/claims";
import { useLocale } from "../../../i18n/i18nContext";
import type { ClaimEntryOptionGroup } from "../../../features/claims/entryOptions";
import type { SourceType } from "../../../types";
import { SOURCE_TYPES } from "../../../types";

interface Props {
  /** 「板块 → 条目」分组；数据来自资料库工作区接口。 */
  entryGroups: ClaimEntryOptionGroup[];
  entriesLoading: boolean;
  /** 资料库读取失败：允许继续填其它字段，只是选不了关联。 */
  entriesFailed: boolean;
  entriesEmpty: boolean;
  /** 编辑的那条带迁移期自动关联标记：提示用户核对。 */
  autoLinked: boolean;
}

export default function ClaimEvidenceFields({
  entryGroups,
  entriesLoading,
  entriesFailed,
  entriesEmpty,
  autoLinked,
}: Props) {
  useLocale();
  const entryExtra = entriesFailed ? (
    <Typography.Text type="danger">{t("claimForm.entryIds.loadFailed")}</Typography.Text>
  ) : entriesEmpty ? (
    <Typography.Text type="secondary">{t("claimForm.entryIds.empty")}</Typography.Text>
  ) : (
    <span>
      {autoLinked && (
        <Typography.Text type="warning" className="claim-form-auto-linked">
          {t("claimForm.hint.autoLinked")} ·{" "}
        </Typography.Text>
      )}
      {t("claimForm.hint.entryIds")}
    </span>
  );

  return (
    <>
      <Form.Item name="entry_ids" label={t("claimForm.field.entryIds")} extra={entryExtra}>
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          loading={entriesLoading}
          disabled={entriesFailed || undefined}
          placeholder={t("claimForm.placeholder.entryIds")}
          options={entryGroups}
        />
      </Form.Item>

      <Typography.Text type="secondary" className="claim-form-section">
        {t("claimForm.evidence.title")}
      </Typography.Text>
      <Form.List name="sources">
        {(fields, { add, remove }) => (
          <div className="claim-source-list">
            {fields.map((field) => (
              <Space key={field.key} size={8} align="start" className="claim-source-row">
                <Form.Item name={[field.name, "type"]} initialValue="link" noStyle>
                  <Select
                    className="claim-source-type"
                    options={SOURCE_TYPES.map((value: SourceType) => ({
                      value,
                      label: t(SOURCE_TYPE_LABEL_KEYS[value]),
                    }))}
                  />
                </Form.Item>
                <Form.Item name={[field.name, "location"]} noStyle>
                  <Input
                    className="claim-source-location"
                    placeholder={t("claimForm.placeholder.evidence")}
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, "public"]}
                  valuePropName="checked"
                  initialValue={false}
                  noStyle
                >
                  <Switch
                    checkedChildren={t("claimForm.evidence.public")}
                    unCheckedChildren={t("claimForm.evidence.private")}
                  />
                </Form.Item>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                  aria-label={t("claimForm.evidence.removeAria")}
                />
              </Space>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => add({ type: "link", public: false })}
            >
              {t("claimForm.evidence.add")}
            </Button>
          </div>
        )}
      </Form.List>
    </>
  );
}
