// SPDX-License-Identifier: Apache-2.0
/**
 * 关于弹窗（问题清单 §19.3）：版本 + 开源许可 / GitHub / 官网，纯静态只读。
 *
 * 版本号与三个外链都来自主进程（about.getInfo），弹窗里不拼 URL——外链点击走
 * desktop-menu.js 的固定动作，渲染层拿不到 shell.openExternal。
 */
import { Button, Modal, Typography } from "antd";
import { useEffect, useState } from "react";
import type { DesktopAboutInfo, DesktopShellBridge } from "./desktopShellBridge";
import { APP_VERSION } from "../../config";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  open: boolean;
  bridge: DesktopShellBridge;
  onClose: () => void;
}

const LINK_ITEMS: { key: "github" | "website" | "license"; labelKey: MessageKey }[] = [
  { key: "github", labelKey: "appHeader.desktopMenu.about.github" },
  { key: "website", labelKey: "appHeader.desktopMenu.about.website" },
  { key: "license", labelKey: "appHeader.desktopMenu.about.license" },
];

export default function AboutDesktopDialog({ open, bridge, onClose }: Props) {
  useLocale();
  const [info, setInfo] = useState<DesktopAboutInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const pending = bridge.menuAction?.("about.getInfo");
    if (pending) {
      void pending
        .then((reply) => {
          if (!active || !reply?.ok || !reply.result) return;
          setInfo(reply.result as DesktopAboutInfo);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [bridge, open]);

  const openExternal = (key: "github" | "website" | "license") => {
    const pending = bridge.menuAction?.(`external.${key}`);
    if (pending) void pending.catch(() => undefined);
  };

  // #34H：「检查更新」只留在「关于」里（帮助菜单里那一份已移除）。点击后由主进程
  // 的系统弹窗给出结论，这里不需要结果状态。
  const checkUpdate = () => {
    const pending = bridge.menuAction?.("help.checkUpdate");
    if (pending) void pending.catch(() => undefined);
  };

  return (
    <Modal
      open={open}
      title={t("appHeader.desktopMenu.about.title")}
      footer={null}
      onCancel={onClose}
      centered
      className="app-titlebar-about-modal"
    >
      <div className="app-titlebar-about">
        <Typography.Text className="app-titlebar-about-version">
          {t("appHeader.desktopMenu.about.version", { version: info?.version ?? APP_VERSION })}
        </Typography.Text>
        <div className="app-titlebar-about-links">
          {LINK_ITEMS.map((link) => (
            <Button key={link.key} type="link" onClick={() => openExternal(link.key)}>
              {t(link.labelKey)}
            </Button>
          ))}
          <Button type="link" onClick={checkUpdate}>
            {t("appHeader.desktopMenu.about.checkUpdate")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
