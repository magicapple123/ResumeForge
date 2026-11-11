// SPDX-License-Identifier: Apache-2.0
/**
 * 队列的四步使用说明（#14G）：从常驻的蓝色 Alert（96px）收进标题旁的「?」Popover。
 *
 * 为什么不是彻底删掉：用户反馈过两次「点进来不知道下一步做什么」，阅读入口要留着。
 * 为什么默认收起：第一次进来默认展开一次（`localStorage: resumeforge.apply.guide_seen`），
 * 看过之后不再自动展开——首屏那 96px 就是为了让表格多显示几行。
 *
 * 标记写失败（隐私模式 / localStorage 被禁）时**只是每次都会展开一次**，不影响任何功能。
 */
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Popover } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

/** 记住"这段说明已经看过"的偏好开关（偏好落 localStorage，与草稿分开）。 */
export const APPLY_GUIDE_SEEN_KEY = "resumeforge.apply.guide_seen";

function hasSeenGuide(): boolean {
  try {
    return window.localStorage.getItem(APPLY_GUIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markGuideSeen(): void {
  try {
    window.localStorage.setItem(APPLY_GUIDE_SEEN_KEY, "1");
  } catch {
    /* 写不进去不是错误：下次进来再展开一次而已。 */
  }
}

export function ApplyQueueGuide() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后说明停在旧文案。
  useLocale();
  const [open, setOpen] = useState<boolean>(() => !hasSeenGuide());

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) markGuideSeen();
  };

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={handleOpenChange}
      title={t("applyQueue.guide.title")}
      content={
        <ol className="apply-queue-guide-steps">
          <li>{t("applyQueue.guide.step1")}</li>
          <li>{t("applyQueue.guide.step2")}</li>
          <li>{t("applyQueue.guide.step3")}</li>
          <li>{t("applyQueue.guide.step4")}</li>
        </ol>
      }
    >
      <Button
        type="text"
        size="small"
        icon={<QuestionCircleOutlined />}
        aria-label={t("applyQueue.guide.triggerAria")}
      />
    </Popover>
  );
}
