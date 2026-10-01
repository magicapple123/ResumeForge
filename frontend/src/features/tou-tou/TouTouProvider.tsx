/** 全局投投状态：开关持久化由设置 API 负责，页面间只共享当前运行态。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAssistantOrbSetting } from "../../api/settings";
import { TouTouContext } from "./touTouContext";
import {
  TOU_TOU_SETTING_EVENT,
  type TouTouSettingEventDetail,
  type TouTouEdge,
  type TouTouStatus,
} from "./touTouTypes";

interface TouTouProviderProps {
  children: ReactNode;
}

export function TouTouProvider({ children }: TouTouProviderProps) {
  const [enabled, setEnabled] = useState(true);
  const [edge, setEdge] = useState<TouTouEdge>("right");
  const [status, setStatus] = useState<TouTouStatus>("idle");

  useEffect(() => {
    let active = true;
    void getAssistantOrbSetting()
      .then((setting) => {
        if (active) setEnabled(setting.enabled);
      })
      .catch(() => {
        // 读取失败时保持默认开启，不能因为设置接口短暂不可用而丢失助手入口。
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleSettingChange = (event: Event) => {
      const detail = (event as CustomEvent<TouTouSettingEventDetail>).detail;
      if (typeof detail?.enabled === "boolean") setEnabled(detail.enabled);
    };
    window.addEventListener(TOU_TOU_SETTING_EVENT, handleSettingChange);
    return () => window.removeEventListener(TOU_TOU_SETTING_EVENT, handleSettingChange);
  }, []);

  const value = useMemo(
    () => ({ enabled, edge, status, setEdge, setStatus }),
    [enabled, edge, status],
  );
  return <TouTouContext.Provider value={value}>{children}</TouTouContext.Provider>;
}
