import { FormOutlined } from "@ant-design/icons";
import { Switch, Tooltip } from "antd";
import { useMemo, useState } from "react";
import type { WebFormBrowserTarget } from "../../types";

interface Props {
  targets: WebFormBrowserTarget[];
  onToggle: (target: WebFormBrowserTarget, enabled: boolean) => void;
}

export default function WebFormTargetFloatingBalls({ targets, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const visibleTargets = useMemo(() => targets.slice(0, 8), [targets]);
  const hiddenCount = Math.max(0, targets.length - visibleTargets.length);
  return (
    <div
      className="webform-target-floating-balls"
      role="group"
      aria-label="网申页面智能逐项填写开关"
    >
      <button
        type="button"
        className="webform-target-floating-toggle"
        aria-expanded={open}
        aria-label={open ? "收起网申页面智能逐项填写开关" : "展开网申页面智能逐项填写开关"}
        onClick={() => setOpen((value) => !value)}
      >
        <FormOutlined />
        <span>{targets.length}</span>
      </button>
      {open ? (
        <>
          {visibleTargets.map((target, index) => (
            <Tooltip
              key={target.target_id}
              title={target.title || target.url || `网申页面 ${index + 1}`}
            >
              <div
                className={`webform-target-floating-ball ${target.live_enabled ? "is-on" : "is-off"}`}
              >
                <span className="webform-target-floating-label">
                  {target.title || `页面 ${index + 1}`}
                </span>
                <Switch
                  checked={target.live_enabled}
                  checkedChildren={<FormOutlined />}
                  unCheckedChildren="关"
                  onChange={(checked) => onToggle(target, checked)}
                  aria-label={`切换 ${target.title || target.url || `网申页面 ${index + 1}`} 的智能逐项填写`}
                />
              </div>
            </Tooltip>
          ))}
          {hiddenCount > 0 ? (
            <span className="webform-target-floating-more">还有 {hiddenCount} 个页面</span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
