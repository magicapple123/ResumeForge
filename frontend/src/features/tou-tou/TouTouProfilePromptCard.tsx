/**
 * 投投悬浮球上的「去改资料」提示卡。
 *
 * 用户停在「我的资料」且没在编辑时（profileEditBridge 有 control），卡片从球旁升起：
 * 一句提示 + 一只「去编辑」按钮，右上角可关掉。它的生命周期（入场 / 退场）归本组件
 * 所有：control 归 null 后仍多留 EXIT_MS 播完反向动画再卸载，避免卡片"啪"地消失。
 *
 * 「关掉之后多久不再出现」不归它管——那是页面侧的状态（详见 profileSaveBridge）。
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { ProfileEditControl } from "./profileSaveBridge";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** 退场动效时长，与 tou-tou.css 的 tt-card-out 对齐；动画播完才真正卸载。 */
const EXIT_MS = 180;

export interface TouTouProfilePromptCardProps {
  /** 有值时展示卡片；用户关掉或进入编辑态后置回 null，卡片反向收回球内。 */
  control: ProfileEditControl | null;
}

export default function TouTouProfilePromptCard({ control }: TouTouProfilePromptCardProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // 与 TouTouSaveCard 同一套状态机：control 归 null 后仍需多留 EXIT_MS 播完反向动画。
  const [shown, setShown] = useState<ProfileEditControl | null>(control);
  const [leaving, setLeaving] = useState(false);
  const wasShownRef = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (control) {
      wasShownRef.current = true;
      setShown(control);
      setLeaving(false);
      return;
    }
    if (!wasShownRef.current) return;
    setLeaving(true);
    const timer = window.setTimeout(
      () => {
        wasShownRef.current = false;
        setShown(null);
        setLeaving(false);
      },
      prefersReducedMotion ? 0 : EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [control, prefersReducedMotion]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!shown) return null;

  return (
    <div
      className={`tt-card tt-profile-prompt-card${leaving ? " is-leaving" : ""}`}
      role="group"
      aria-label="修改我的资料"
    >
      <p className="tt-profile-prompt-card-title">
        想补充或修改资料？
        {/* 关闭键的名字刻意不带「编辑资料」四个字：读屏按名检索时，它不该和页头那只
            「编辑资料」按钮混起来。 */}
        <button
          type="button"
          className="tt-profile-prompt-card-close"
          aria-label="关闭提示卡"
          onClick={(event) => {
            // 卡片是球的兄弟节点，事件本就不会落进球的单击/双击判定；
            // 这里按契约显式拦截，防止未来结构调整后误触发球的开卡逻辑。
            event.stopPropagation();
            shown.onDismiss();
          }}
        >
          ×
        </button>
      </p>
      <div className="tt-profile-prompt-card-actions">
        <Button
          type="primary"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            shown.onEdit();
          }}
        >
          去编辑
        </Button>
      </div>
      {/* 指向悬浮球的小尾巴（球在卡片右下方，尾巴水平对齐球心）。 */}
      <span className="tt-card-tail" aria-hidden="true" />
    </div>
  );
}
