// SPDX-License-Identifier: Apache-2.0
/**
 * 「从链接导入」入口（#16C）：按钮 + 弹窗自包含，页面只需放一个元素。
 * 导入成功后调用 onImported 让岗位广场刷新列表——按需求**不跳转、不自动入队**。
 */
import { LinkOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { ButtonProps } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { consumePendingJobUrlImport, OPEN_JOB_IMPORT_EVENT } from "../desktop/desktopJobImport";
import { ImportFromUrlModal } from "./ImportFromUrlModal";

interface Props {
  onImported: () => void;
  disabled?: boolean;
  buttonSize?: ButtonProps["size"];
}

export function ImportFromUrlLauncher({ onImported, disabled, buttonSize }: Props) {
  useLocale();
  const [open, setOpen] = useState(false);

  // 桌面菜单「文件 → 从链接导入岗位…」（#34B）：菜单只发窗口事件，"打开哪套弹窗、
  // 导入后怎么刷新"仍然由页面这一份 launcher 决定（不重写第二套入口）。
  // 从别的页面跳过来时事件早于本组件挂载，所以再消费一次"待打开"标记。
  useEffect(() => {
    const openFromMenu = () => setOpen(true);
    window.addEventListener(OPEN_JOB_IMPORT_EVENT, openFromMenu);
    // 从别的页面跳过来时事件早于本组件挂载：补开一次。走宏任务而不是在 effect 体内
    // 同步 setState（后者会多一轮渲染，且 react-hooks 规则会报）。
    const pendingTimer = consumePendingJobUrlImport() ? setTimeout(openFromMenu, 0) : null;
    return () => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      window.removeEventListener(OPEN_JOB_IMPORT_EVENT, openFromMenu);
    };
  }, []);

  return (
    <>
      <Button
        size={buttonSize}
        icon={<LinkOutlined />}
        disabled={disabled || undefined}
        onClick={() => setOpen(true)}
      >
        {t("jobsImport.launcher")}
      </Button>
      <ImportFromUrlModal open={open} onClose={() => setOpen(false)} onImported={onImported} />
    </>
  );
}
