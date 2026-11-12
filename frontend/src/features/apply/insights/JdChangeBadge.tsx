// SPDX-License-Identifier: Apache-2.0
/**
 * #15B 投递记录行的「你投的岗位有变更」徽标：点开是 before / after 两栏对比。
 *
 * 三种情况分开处理（都不影响记录本身）：
 * - `jd_changed` 不为 true → **不渲染**（没变更就没有徽标，不留一个"恒亮的提示"）；
 * - 有 `queue_id` → 可点，打开 `JdChangeDrawer`（明细按队列条目 id 取）；
 * - 没有 `queue_id` → 徽标仍显示（"有变更"这件事是真的），但只给 Tooltip 说明为什么
 *   点不开：`/jd-change` 只认队列条目 id，**绝不拿 job_id 或相邻条目的 id 去猜**
 *   （猜错就会把别人岗位的 diff 摆在这个岗位下面，比不给更糟）。
 *
 * 徽标文案不带数字：契约只有布尔值，没有"几处变更"这个字段，写「1 处」会是编造的。
 */
import { Tag, Tooltip } from "antd";
import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyRecord } from "../../../types";
import JdChangeDrawer from "./JdChangeDrawer";

interface Props {
  /** 投递记录（只用到 `jd_changed` 与 `queue_id`）。 */
  record: ApplyRecord;
}

export default function JdChangeBadge({ record }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const [open, setOpen] = useState(false);

  if (record.jd_changed !== true) return null;

  const queueId = record.queue_id ?? null;
  if (queueId === null) {
    return (
      <Tooltip title={t("applyQueue.insights.jdChange.noId")}>
        <Tag className="apply-jd-change-badge" color="gold">
          {t("applyQueue.insights.jdChange.badge")}
        </Tag>
      </Tooltip>
    );
  }

  const openDrawer = () => setOpen(true);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openDrawer();
  };

  return (
    <>
      <Tag
        className="apply-jd-change-badge"
        color="gold"
        // Tag 渲染成 span：补 role/tabIndex 才有键盘等价（Enter / 空格打开抽屉）。
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={openDrawer}
        aria-label={t("applyQueue.insights.jdChange.badge")}
      >
        {t("applyQueue.insights.jdChange.badge")}
      </Tag>
      <JdChangeDrawer open={open} queueId={queueId} onClose={() => setOpen(false)} />
    </>
  );
}
