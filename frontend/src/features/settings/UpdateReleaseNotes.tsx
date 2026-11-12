// SPDX-License-Identifier: Apache-2.0
/**
 * 更新说明块：从「结果 Alert」里搬出来的独立一块，可展开 / 收起。
 *
 * ## 为什么独立成块
 *
 * 此前发布说明塞在结果 Alert 的 description 里，为了不让长公告把卡片撑爆，里面套了
 * `maxHeight: min(40vh, 420px)` + `overflowY: auto`：卡片实测 789px，其中 Alert 占掉
 * 六成，说明还自带一条内滚条——既难读（两个滚动上下文），又看不出结论（结论被说明挤到
 * 上面一小行）。现在 Alert 只留结论与主操作，说明自成一块：
 *
 * - **没有内滚**：说明块自身不设 `max-height` / `overflow`，页面只有一条滚动条；
 * - **默认收起**：2.0 那种整篇公告展开后一屏多高，卡片不该一进来就把整页撑长；
 * - 展开状态机在本组件里（`aria-expanded` + `hidden`），不引入 antd Collapse 的动画
 *   与内层 padding——高度要可量、可断言。
 */

import { Button, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { renderReleaseNotes } from "./updateNotesRenderer";

export interface UpdateReleaseNotesProps {
  /** GitHub Release 正文（markdown 子集，交给 updateNotesRenderer 解析）。 */
  notes: string;
}

/** 说明块的 id：`aria-controls` 指向它，屏幕阅读器才知道这个开关控制哪一片。 */
const NOTES_BODY_ID = "update-notes-body";

export default function UpdateReleaseNotes({ notes }: UpdateReleaseNotesProps) {
  // 切语言要重译「展开 / 收起」，所以订阅当前语言（文案在渲染期取，不进 state）。
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <section className="update-notes">
      <div className="update-notes-header">
        <Typography.Text strong className="update-notes-title">
          {t("update.notes.title")}
        </Typography.Text>
        <Button
          type="link"
          size="small"
          className="update-notes-toggle"
          aria-expanded={open}
          aria-controls={NOTES_BODY_ID}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? t("update.notes.collapse") : t("update.notes.expand")}
        </Button>
      </div>
      {/* 收起时用 hidden 而不是 maxHeight: 0：内容仍可被读屏/查找命中，布局上是真的
          不存在，不会留下一条空的可滚区域。 */}
      <div className="update-notes-body" id={NOTES_BODY_ID} hidden={!open}>
        {renderReleaseNotes(notes)}
      </div>
    </section>
  );
}
