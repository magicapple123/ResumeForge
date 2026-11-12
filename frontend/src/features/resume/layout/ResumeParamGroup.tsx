// SPDX-License-Identifier: Apache-2.0
/**
 * 参数分组壳：一个可折叠的标题 + 一组参数控件（简历制作台左栏用）。
 *
 * ## 为什么折叠状态存 `localStorage` 而不是草稿
 *
 * "我习惯先看颜色、不关心模板"是**这个人**的偏好，不是**这份简历**的属性。存进
 * `format_config` 会跟着导出走，还会进指纹；存进草稿则换一份简历就重置。所以只存本地，
 * 键名带上 `resume.wb.group.` 前缀，与 `sessionStorage` 的编辑草稿（`resume.edit#…`）
 * 完全分开——两者生命周期不同，混在一起会出现"清了草稿，分组全折叠"。
 *
 * ## 为什么标题是按钮而不是 `Collapse`
 *
 * `Collapse` 会自己带一套展开动画、图标位置与内边距，六个分组摞起来就是六段"面板头"，
 * 想统一卡片观感反而要一层层压掉它的样式。这里只要"卡片头（整行可点）+ 一块内容"，
 * 视觉（细边框 + 圆角 + 内边距）全部交给 `workbench-params.css` 的 `.resume-wb-group`。
 *
 * 2026-10-29（用户："左边各个功能之间的区分不是很明显"）：分组从"无边框的纯文本标题"
 * 改成**轻卡片**——边框与 10/12 内边距让每一块功能自己站住，不再糊成一段连续文字。
 * 折叠态只留一行 32px 的卡片头，高度与展开态的卡片头一致，切换时不跳动。
 */
import { DownOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface Props {
  /** 分组标题（已是译文；调用方传 `t("workbench.group.*")`）。 */
  title: string;
  /** `localStorage` 的键后缀：同一份界面里的分组不能撞。 */
  storageKey: string;
  /** 没有存过偏好时的初始状态。 */
  defaultOpen?: boolean;
  children?: ReactNode;
}

/** `localStorage` 前缀：与 `sessionStorage` 的编辑草稿明确分开（见文件头）。 */
const STORAGE_PREFIX = "resume.wb.group.";

/** 读偏好：读不到（首次 / 隐私模式 / JSON 坏了）就是 `null`，由调用方给默认值。 */
function readPreference(storageKey: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    // 隐私模式下 `localStorage` 会抛：折叠偏好不好用不该让整栏渲染失败。
    return null;
  }
}

function writePreference(storageKey: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "1" : "0");
  } catch {
    // 同上：存不下就只在本次会话里生效。
  }
}

export default function ResumeParamGroup({
  title,
  storageKey,
  defaultOpen = true,
  children,
}: Props) {
  const [open, setOpen] = useState<boolean>(() => readPreference(storageKey) ?? defaultOpen);

  // 只在展开状态真的变化时写：初次渲染也写一次是刻意的——把"用户看过的默认值"落下来，
  // 否则以后改 `defaultOpen` 会悄悄改变已有用户的界面。
  useEffect(() => {
    writePreference(storageKey, open);
  }, [storageKey, open]);

  return (
    <section className="resume-wb-group">
      <Button
        type="text"
        size="small"
        className="resume-wb-group-title"
        // 图标（`role="img"`）会参与可访问名计算，不写 aria-label 就会读成「标题 down」。
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="resume-wb-group-label">{title}</span>
        <DownOutlined className={`resume-wb-group-chevron${open ? " is-open" : ""}`} />
      </Button>
      {open ? <div className="resume-wb-group-body">{children}</div> : null}
    </section>
  );
}
