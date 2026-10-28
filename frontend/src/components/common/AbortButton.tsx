// SPDX-License-Identifier: Apache-2.0
/**
 * 「停止」按钮：「点一下 → 等结果 → 回填」的面板共用同一颗。
 *
 * 为什么统一成一个组件而不是各面板写一遍 `<Button danger icon={<StopOutlined />}>`：
 * 1. 文案只有一处（`common.action.stop`），不会出现半个面板写"停止"、半个写"取消"；
 * 2. `data-testid` 稳定，既有测试用 `getByRole("button", { name: ... })` 定位主按钮时
 *    不会因为多出这颗按钮而多命中（需要时按 testid 限定范围）；
 * 3. 样式一致：danger + 图标 + 文案（只有图标对"点一下会停掉正在花钱的请求"提示不足）。
 *
 * 外观与面试页的「停止本轮」一致（`pages/interview/Composer.tsx`）——同一件事不该有两种样子。
 */
import { StopOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 停止按钮的稳定测试锚点（见文件头第 2 条）。 */
export const ABORT_BUTTON_TESTID = "abort-request";

interface Props {
  /** 点击即断开在跑的请求：面板当场回到可再点状态，不弹错误。 */
  onClick: () => void;
  /** 与所在面板的主按钮对齐（小面板用 small）。 */
  size?: "small" | "middle";
  /** 生成中主按钮隐藏时（例如整块换成 loading 占位）也能单独出现在工具栏里。 */
  disabled?: boolean;
}

export default function AbortButton({ onClick, size, disabled }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后按钮文案不跟着变。
  useLocale();
  return (
    <Button
      danger
      size={size}
      disabled={disabled}
      icon={<StopOutlined />}
      data-testid={ABORT_BUTTON_TESTID}
      onClick={onClick}
    >
      {t("common.action.stop")}
    </Button>
  );
}
