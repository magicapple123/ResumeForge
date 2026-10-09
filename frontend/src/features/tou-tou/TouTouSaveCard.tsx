/**
 * 投投悬浮球上的「保存资料 / 取消」浮卡。
 *
 * 简历资料编辑页表单变脏时（profileSaveBridge 有 control），卡片从悬浮球旁升起，
 * 用一行说明交代"为什么冒出来"，并用一只指向球心的小尾巴把卡片和球绑在一起——
 * 它的生命周期（入场 / 退场）归本组件所有：control 归 null 后仍多留 EXIT_MS 播完
 * 反向动画再卸载，避免卡片"啪"地消失显得突兀。
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { ProfileSaveControl } from "./profileSaveBridge";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** 退场动效时长，与 tou-tou.css 的 tt-card-out 对齐；动画播完才真正卸载。 */
const EXIT_MS = 180;

export interface TouTouSaveCardProps {
  /** 有值时展示卡片；页面保存/取消后置回 null，卡片反向收回球内。 */
  control: ProfileSaveControl | null;
}

export default function TouTouSaveCard({ control }: TouTouSaveCardProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // 退场要留住最后一份 control：control 归 null 后仍需多留 EXIT_MS 播完反向动画。
  const [shown, setShown] = useState<ProfileSaveControl | null>(control);
  const [leaving, setLeaving] = useState(false);
  // 是否展示过卡片：避免刚挂载（control 一直是 null）时白排一个退场定时器。
  const wasShownRef = useRef(false);

  // 挂载 / 退场是一个带定时器的状态机：control 变化驱动 shown/leaving 迁移，拆开反而
  // 引入中间态。按书面理由豁免 Compiler 规则。
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
      className={`tt-card tt-save-card${leaving ? " is-leaving" : ""}`}
      role="group"
      aria-label="保存简历资料"
    >
      <p className="tt-save-card-title">
        {/* 脏状态提示点：含义由标题文字承载，圆点纯装饰（读屏隐藏）。 */}
        <span className="tt-save-card-dot" aria-hidden="true" />
        资料有未保存的修改
      </p>
      <div className="tt-save-card-actions">
        <Button
          type="primary"
          size="small"
          loading={shown.saving === true}
          onClick={(event) => {
            // 卡片是球的兄弟节点，事件本就不会落进球的单击/双击判定；
            // 这里按契约显式拦截，防止未来结构调整后误触发球的开卡逻辑。
            event.stopPropagation();
            shown.onSave();
          }}
        >
          保存资料
        </Button>
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            shown.onCancel();
          }}
        >
          取消
        </Button>
      </div>
      {/* 指向悬浮球的小尾巴（球在卡片右下方，尾巴水平对齐球心）。 */}
      <span className="tt-card-tail tt-save-card-tail" aria-hidden="true" />
    </div>
  );
}
