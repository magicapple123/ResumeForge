import { Button, Drawer, Menu } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useEffect, useLayoutEffect, useRef } from "react";

interface Props {
  open: boolean;
  items: MenuProps["items"];
  selectedKey: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onOpenGuide: () => void;
}

/** 关闭后把焦点送回抽屉的触发按钮，或送回页面主内容（选了一个目的地）。 */
function focusAfterCloseTarget(kind: "trigger" | "content") {
  const target = kind === "content" ? "main-content" : "mobile-navigation-trigger";
  document.getElementById(target)?.focus({ preventScroll: true });
}

/** The desktop menu and this drawer share the same visible destinations. */
export default function MobileNavigation({
  open,
  items,
  selectedKey,
  onClose,
  onNavigate,
  onOpenGuide,
}: Props) {
  const focusAfterClose = useRef<"trigger" | "content" | null>("trigger");
  const previouslyOpen = useRef(false);
  // A quick close can skip the animation's afterOpenChange(false) callback.
  useLayoutEffect(() => {
    const closing = previouslyOpen.current && !open;
    previouslyOpen.current = open;
    if (!closing || focusAfterClose.current === null) return;
    focusAfterCloseTarget(focusAfterClose.current);
  }, [open]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const onResize = (event: MediaQueryListEvent) => {
      if (event.matches) {
        focusAfterClose.current = null;
        onClose();
      }
    };
    media.addEventListener("change", onResize);
    return () => media.removeEventListener("change", onResize);
  }, [onClose]);

  return (
    <Drawer
      title="功能导航"
      placement="left"
      size={288}
      open={open}
      onClose={() => {
        focusAfterClose.current = "trigger";
        onClose();
      }}
      afterOpenChange={(visible) => {
        // 退场动画结束、抽屉真正卸载后再补一次。rc-drawer 的焦点清理可能晚于
        // 上面的 layout effect，把焦点送回 body（慢速 runner 上偶发）。
        if (visible || focusAfterClose.current === null) return;
        focusAfterCloseTarget(focusAfterClose.current);
      }}
      destroyOnHidden
      focusable={{ focusTriggerAfterClose: false }}
      className="app-mobile-navigation"
      styles={{ body: { padding: 8 } }}
      footer={
        <Button
          block
          icon={<QuestionCircleOutlined />}
          onClick={() => {
            // The guide owns focus once it opens; do not return it to the menu.
            focusAfterClose.current = null;
            onClose();
            onOpenGuide();
          }}
        >
          使用指南
        </Button>
      }
    >
      <nav aria-label="移动端主导航" id="mobile-navigation">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => {
            focusAfterClose.current = "content";
            onNavigate(key);
            onClose();
          }}
        />
      </nav>
    </Drawer>
  );
}
