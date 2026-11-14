// SPDX-License-Identifier: Apache-2.0
/** 台账表单的「核实」字段组：承担程度 / 核实状态 / 最近核实 / 个人边界 / 可用范围。 */
import { DatePicker, Form, Input, Select } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import {
  RESPONSIBILITY_LEVEL_HINT_KEYS,
  RESPONSIBILITY_LEVEL_LABEL_KEYS,
  VERIFICATION_STATUS_HINT_KEYS,
  VERIFICATION_STATUS_LABEL_KEYS,
} from "../../../i18n/enum/claims";
import { useLocale } from "../../../i18n/i18nContext";
import { RESPONSIBILITY_LEVELS, VERIFICATION_STATUSES } from "../../../types";

interface HintOption {
  value: string;
  /** 整句「名称——解释」：仍是 title 与搜索匹配的文本（收起态不用它）。 */
  label: string;
  /** 与 label 相同，显式给 `optionFilterProp="title"` 与读屏用。 */
  title: string;
  /** 收起态显示的短名。 */
  short: string;
  hint: string;
}

function buildOptions<K extends string>(
  values: readonly K[],
  labelKeys: Record<K, MessageKey>,
  hintKeys: Record<K, MessageKey>,
): HintOption[] {
  return values.map((value) => {
    const short = t(labelKeys[value]);
    const hint = t(hintKeys[value]);
    const full = t("enumsClaims.optionWithHint", { label: short, hint });
    return { value, label: full, title: full, short, hint };
  });
}

/** 两行选项：名称一行、解释一行。写进 320px 的弹层，避免整句被裁成"参与——在他人安排下完成其中一…"。 */
function HintOptionRow({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="claim-option">
      <span className="claim-option-label">{label}</span>
      <span className="claim-option-hint">{hint}</span>
    </div>
  );
}

interface Props {
  /** 台账里已有的「可用范围」取值；沿用台账历史，减少拼写变体。 */
  allowedUseOptions: string[];
}

export default function ClaimVerifyFields({ allowedUseOptions }: Props) {
  useLocale();
  // 选项的 value 仍是协议值（提交后端），只有显示名与解释走语言包。
  const responsibilityOptions = buildOptions(
    RESPONSIBILITY_LEVELS,
    RESPONSIBILITY_LEVEL_LABEL_KEYS,
    RESPONSIBILITY_LEVEL_HINT_KEYS,
  );
  const statusOptions = buildOptions(
    VERIFICATION_STATUSES,
    VERIFICATION_STATUS_LABEL_KEYS,
    VERIFICATION_STATUS_HINT_KEYS,
  );
  // 收起态只显示短名：这一格在 880 弹窗里约 274px，整句必然被截断。
  const shortLabel = (options: HintOption[], value: unknown) =>
    options.find((option) => option.value === String(value ?? ""))?.short ?? String(value ?? "");

  return (
    <>
      <div className="claim-form-row">
        <Form.Item
          name="responsibility_level"
          label={t("claimForm.field.responsibility")}
          className="claim-form-grow"
        >
          <Select
            options={responsibilityOptions}
            optionFilterProp="title"
            popupMatchSelectWidth={false}
            classNames={{ popup: { root: "claim-option-popup" } }}
            labelRender={({ value }) => shortLabel(responsibilityOptions, value)}
            optionRender={(option) => (
              <HintOptionRow label={option.data.short} hint={option.data.hint} />
            )}
          />
        </Form.Item>
        <Form.Item
          name="verification_status"
          label={t("claimForm.field.verification")}
          className="claim-form-grow"
        >
          <Select
            options={statusOptions}
            optionFilterProp="title"
            popupMatchSelectWidth={false}
            classNames={{ popup: { root: "claim-option-popup" } }}
            labelRender={({ value }) => shortLabel(statusOptions, value)}
            optionRender={(option) => (
              <HintOptionRow label={option.data.short} hint={option.data.hint} />
            )}
          />
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
          options={allowedUseOptions.map((value) => ({ value, label: value }))}
        />
      </Form.Item>
    </>
  );
}
