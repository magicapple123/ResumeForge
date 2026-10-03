/**
 * 「最大输出 Token 不限制」的表单联动逻辑。
 * （自 LLMConfigCard 拆出：max_tokens watch + lastLimitedTokens ref + setUnlimitedTokens，
 * 原样搬运；form 实例由卡片持有。）
 */
import { Form } from "antd";
import type { FormInstance } from "antd/es/form";
import { useRef } from "react";
import {
  DEFAULT_MAX_TOKENS,
  MIN_MAX_TOKENS,
  UNLIMITED_MAX_TOKENS,
  type SettingsFormValues,
} from "../SettingsConfig";

export function useUnlimitedTokens(form: FormInstance<SettingsFormValues>): {
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
