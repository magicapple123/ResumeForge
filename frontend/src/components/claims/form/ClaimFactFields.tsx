// SPDX-License-Identifier: Apache-2.0
/** 台账表单的「原始事实」字段组：标题 / 分类 / 主体 / 原始事实 / 简历表述。 */
import { Form, Input, Select } from "antd";
import { t } from "../../../i18n";
import { CLAIM_CATEGORY_LABEL_KEYS } from "../../../i18n/enum/claims";
import { useLocale } from "../../../i18n/i18nContext";
import { CLAIM_CATEGORIES } from "../../../types";
import { HintedTextArea } from "../../common/MaxLengthHint";

export default function ClaimFactFields() {
  useLocale();
  const categoryOptions = CLAIM_CATEGORIES.map((value) => ({
    value,
    label: t(CLAIM_CATEGORY_LABEL_KEYS[value]),
  }));

  return (
    <>
      {/* 这里刻意用普通 div 而不是 antd 的 Space：Space 会给每个子项再包一层
          .ant-space-item，flex 宽度落在内层 Form.Item 上、管不到真正的 flex 子项，
          结果就是窄列被挤成一条竖排文字。 */}
      <div className="claim-form-row">
        <Form.Item name="title" label={t("claimForm.field.title")} className="claim-form-grow">
          <Input placeholder={t("claimForm.placeholder.title")} maxLength={200} />
        </Form.Item>
        <Form.Item
          name="category"
          label={t("claimForm.field.category")}
          className="claim-form-fixed"
        >
          <Select options={categoryOptions} />
        </Form.Item>
      </div>

      <Form.Item
        name="subject"
        label={t("claimForm.field.subject")}
        extra={t("claimForm.hint.subject")}
      >
        <Input placeholder={t("claimForm.placeholder.subject")} maxLength={200} />
      </Form.Item>

      <Form.Item
        name="source_fact"
        label={t("claimForm.field.sourceFact")}
        extra={t("claimForm.hint.sourceFact")}
        rules={[{ required: true, message: t("claimForm.required.sourceFact") }]}
      >
        {/* showCount 已移除（统一用 MaxLengthHint 模式）：只有顶到 8000 字上限时，
            才在输入框下方出现一行小号红字提醒。 */}
        <HintedTextArea
          rows={3}
          maxLength={8000}
          placeholder={t("claimForm.placeholder.sourceFact")}
        />
      </Form.Item>

      <Form.Item
        name="candidate_wording"
        label={t("claimForm.field.wording")}
        extra={t("claimForm.hint.wording")}
      >
        <Input.TextArea
          rows={2}
          maxLength={8000}
          placeholder={t("claimForm.placeholder.wording")}
        />
      </Form.Item>
    </>
  );
}
