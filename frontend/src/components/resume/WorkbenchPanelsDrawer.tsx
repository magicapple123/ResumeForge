// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的两个抽屉（排版参数 / 内容编辑）。
 *
 * 2026-10-23 从 `ResumeZoomModal.tsx` 拆出：外壳已到 504 行、超 500 行预算，而这一块是
 * 纯容器——两份内容由宿主持有（参数栏与内容栏本来就是同一份 JSX，三栏时渲染进栅格）。
 *
 * 两条性质写在类型里而不是注释里：
 * 1. **两抽屉互斥**：只有一个 `openPanel` 状态，同时最多开一个（768 宽时两个 378 会把画布
 *    全盖住）；
 * 2. `size="default"`（378）是拍板值（方案附录 D3），不要改成数字宽度——`popupGuard` P4
 *    也不许用数字宽度（`popupGuard` 的 P4）。
 */
import { Drawer } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  openPanel: "params" | "content" | null;
  onClose: () => void;
  editorEnabled: boolean;
  hasSettings: boolean;
  editor: ReactNode;
  params: ReactNode;
}

export default function WorkbenchPanelsDrawer({
  openPanel,
  onClose,
  editorEnabled,
  hasSettings,
  editor,
  params,
}: Props) {
  useLocale();
  return (
    <>
      <Drawer
        className="resume-wb-drawer"
        open={editorEnabled && openPanel === "content"}
        onClose={onClose}
        title={t("responsive.drawer.content.title")}
        size="default"
        destroyOnHidden
      >
        {editor}
      </Drawer>
      <Drawer
        className="resume-wb-drawer"
        open={hasSettings && openPanel === "params"}
        onClose={onClose}
        title={t("responsive.drawer.params.title")}
        size="default"
        destroyOnHidden
      >
        {params}
      </Drawer>
    </>
  );
}
