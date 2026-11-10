// SPDX-License-Identifier: Apache-2.0
/** 台账表单的「面试细节」字段组：决策 / 难点 / 验证 / 结果 / 风险备注。 */
import { Form, Input, Select } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export default function ClaimInterviewFields() {
  useLocale();

  return (
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
        <Form.Item name="result" label={t("claimForm.field.result")} className="claim-form-grow">
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
  );
}
