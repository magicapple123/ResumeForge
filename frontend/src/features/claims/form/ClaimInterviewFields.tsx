// SPDX-License-Identifier: Apache-2.0
/** 台账表单的「面试细节」字段组：决策 / 难点 / 验证 / 结果 / 风险备注。 */
import { Collapse, Form, Input, Select, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { FormValues } from "./claimFormTypes";

interface Props {
  /** 编辑已有内容的条目时展开；新建时收起（五块都空时展开只会制造一屏空输入框）。 */
  defaultOpen: boolean;
}

export default function ClaimInterviewFields({ defaultOpen }: Props) {
  useLocale();
  const form = Form.useFormInstance<FormValues>();
  // 值存在表单 store 里（折叠收起后 Form.Item 卸载但 preserve），所以计数在收起态仍然准确。
  const values = Form.useWatch<FormValues>([], form);
  const filledCount =
    [values?.decisions, values?.difficulties, values?.verification, values?.result].filter(
      (value) => Boolean(String(value ?? "").trim()),
    ).length + ((values?.risk_notes ?? []).length > 0 ? 1 : 0);

  return (
    <Collapse
      ghost
      className="claim-form-collapse"
      // 每次打开重算展开态：弹窗销毁重建，这里的 defaultActiveKey 不会被上一次的展开带走。
      destroyOnHidden
      defaultActiveKey={defaultOpen ? ["interview"] : []}
      items={[
        {
          key: "interview",
          label: (
            <span className="claim-form-section-head">
              <Typography.Text className="claim-form-section">
                {t("claimForm.interview.title")}
              </Typography.Text>
              <span className="claim-form-filled">
                {t("claimForm.interview.filledCount", { count: filledCount })}
              </span>
            </span>
          ),
          children: (
            <>
              <div className="claim-form-row">
                <Form.Item
                  name="decisions"
                  label={t("claimForm.field.decisions")}
                  className="claim-form-grow"
                  extra={t("claimForm.hint.onePerLine")}
                >
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item
                  name="difficulties"
                  label={t("claimForm.field.difficulties")}
                  className="claim-form-grow"
                  extra={t("claimForm.hint.onePerLine")}
                >
                  <Input.TextArea rows={3} />
                </Form.Item>
              </div>
              <div className="claim-form-row">
                <Form.Item
                  name="verification"
                  label={t("claimForm.field.howVerified")}
                  className="claim-form-grow"
                  extra={t("claimForm.hint.onePerLine")}
                >
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item
                  name="result"
                  label={t("claimForm.field.result")}
                  className="claim-form-grow"
                >
                  <Input.TextArea rows={3} placeholder={t("claimForm.placeholder.result")} />
                </Form.Item>
              </div>

              <Form.Item
                name="risk_notes"
                label={t("claimForm.field.riskNotes")}
                extra={t("claimForm.hint.riskNotes")}
              >
                <Select
                  mode="tags"
                  placeholder={t("claimForm.placeholder.riskNotes")}
                  open={false}
                  suffixIcon={null}
                />
              </Form.Item>
            </>
          ),
        },
      ]}
    />
  );
}
