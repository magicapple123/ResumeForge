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
    const target =
      focusAfterClose.current === "content" ? "main-content" : "mobile-navigation-trigger";
    document.getElementById(target)?.focus({ preventScroll: true });
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
