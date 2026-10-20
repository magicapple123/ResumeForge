// SPDX-License-Identifier: Apache-2.0
/**
 * 「最大输出 Token 不限制」的表单联动逻辑。
 *
 * max_tokens watch + lastLimitedTokens ref + setUnlimitedTokens，原样搬运；
 * form 实例由调用方持有。参数用宽化的 FormInstance：antd 对 Form.useWatch 的
 * 字段名推导要求具体类型，而这里只碰 max_tokens 一个字段，两种表单值
 * （记录弹窗的 RecordFormValues 与旧设置表单的 SettingsFormValues）都带它。
 */
import { Form } from "antd";
import type { FormInstance } from "antd/es/form";
import { useRef } from "react";
import { DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS, UNLIMITED_MAX_TOKENS } from "../SettingsConfig";

export function useUnlimitedTokens(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: FormInstance<any>,
): {
  unlimitedTokens: boolean;
  setUnlimitedTokens: (unlimited: boolean) => void;
} {
  const maxTokens = Form.useWatch("max_tokens", form);
  const unlimitedTokens = maxTokens === UNLIMITED_MAX_TOKENS;
  // 记住勾选「不限制」之前的值，取消勾选时原样还回去，免得用户重填。
  const lastLimitedTokens = useRef(DEFAULT_MAX_TOKENS);

  const setUnlimitedTokens = (unlimited: boolean) => {
    if (unlimited) {
      // 只在写入 0 之前读取：此时字段里还是用户原本填的有限值。
      const current = form.getFieldValue("max_tokens");
      if (typeof current === "number" && current >= MIN_MAX_TOKENS) {
        lastLimitedTokens.current = current;
      }
    }
    form.setFieldValue("max_tokens", unlimited ? UNLIMITED_MAX_TOKENS : lastLimitedTokens.current);
  };

  return { unlimitedTokens, setUnlimitedTokens };
}
