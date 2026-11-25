// SPDX-License-Identifier: Apache-2.0
/**
 * 队列的四步使用说明（#14G）：从常驻的蓝色 Alert（96px）收进标题旁的「?」Popover。
 *
 * 为什么不是彻底删掉：用户反馈过两次「点进来不知道下一步做什么」，阅读入口要留着。
 * 为什么默认收起且**不再自动展开**（CR-17）：首屏那 96px 是留给表格的；自动弹一次
 * 反而让用户先看到浮层、看不到队列本身。说明只由用户点「?」打开，不写任何存储标记。
 */
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Popover } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export function ApplyQueueGuide() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后说明停在旧文案。
  useLocale();
  const [open, setOpen] = useState(false);

  return (
    <Popover
      trigger="click"
      // 右对齐而不是左对齐：触发按钮在工具栏最右端，`bottomLeft` 会把 402px 宽的气泡
      // 从右端往右推，document 因此多出 16px 横向滚动（CI 的 ui-quality 在 /apply 上
      // 判 document overflow，1200×900 也复现）。气泡宽度同时夹到视口内，窄屏不至于
      // 把左边挤出屏幕。
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      // 宽度夹在视口内：`content` 只约束正文（还要加上气泡自身 24px 内边距），`root` 才
      // 是外层那个可能超出视口的盒子——375 宽实测右缘会多出 8px（CI 判 document overflow）。
      styles={{
        root: { maxWidth: "calc(100vw - 32px)" },
        content: { maxWidth: "100%" },
      }}
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
