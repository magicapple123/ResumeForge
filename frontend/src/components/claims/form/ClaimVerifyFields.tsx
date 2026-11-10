// SPDX-License-Identifier: Apache-2.0
/** 台账表单的「核实」字段组：承担程度 / 核实状态 / 最近核实 / 个人边界 / 可用范围。 */
import { DatePicker, Form, Input, Select } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { t } from "../../../i18n";
import {
  RESPONSIBILITY_LEVEL_HINT_KEYS,
  RESPONSIBILITY_LEVEL_LABEL_KEYS,
  VERIFICATION_STATUS_HINT_KEYS,
  VERIFICATION_STATUS_LABEL_KEYS,
} from "../../../i18n/enum/claims";
import { useLocale } from "../../../i18n/i18nContext";
import { RESPONSIBILITY_LEVELS, VERIFICATION_STATUSES } from "../../../types";

export default function ClaimVerifyFields() {
  useLocale();
  // 选项的 value 仍是协议值（提交后端），只有显示名与解释走语言包。
  const responsibilityOptions = RESPONSIBILITY_LEVELS.map((value) => ({
    value,
    label: t("enumsClaims.optionWithHint", {
      label: t(RESPONSIBILITY_LEVEL_LABEL_KEYS[value]),
      hint: t(RESPONSIBILITY_LEVEL_HINT_KEYS[value]),
    }),
  }));
  const statusOptions = VERIFICATION_STATUSES.map((value) => ({
    value,
    label: t("enumsClaims.optionWithHint", {
      label: t(VERIFICATION_STATUS_LABEL_KEYS[value]),
      hint: t(VERIFICATION_STATUS_HINT_KEYS[value]),
    }),
  }));

  return (
    <>
      <div className="claim-form-row">
        <Form.Item
          name="responsibility_level"
          label={t("claimForm.field.responsibility")}
          className="claim-form-grow"
        >
          <Select options={responsibilityOptions} />
        </Form.Item>
        <Form.Item
          name="verification_status"
          label={t("claimForm.field.verification")}
          className="claim-form-grow"
        >
          <Select options={statusOptions} />
        </Form.Item>
        {/* 日期用固定宽度；DatePicker 值走 Dayjs，表单里仍存 YYYY-MM-DD 字符串（E12）。 */}
        <Form.Item
          name="last_verified"
          label={t("claimForm.field.lastVerified")}
          className="claim-form-date"
          getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
          normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
      </div>

      <Form.Item
        name="boundary"
        label={t("claimForm.field.boundary")}
        extra={t("claimForm.hint.boundary")}
      >
        <Input.TextArea
          rows={2}
          maxLength={1000}
          placeholder={t("claimForm.placeholder.boundary")}
        />
      </Form.Item>

      <Form.Item name="allowed_uses" label={t("claimForm.field.allowedUses")}>
        <Select
          mode="tags"
          placeholder={t("claimForm.placeholder.allowedUses")}
          open={false}
          suffixIcon={null}
        />
      </Form.Item>
    </>
  );
}
