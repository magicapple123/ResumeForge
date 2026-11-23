// SPDX-License-Identifier: Apache-2.0
import type { AssistantSurface } from "../types";

export interface AssistantPageProps {
  /**
   * 挂载后把焦点送进输入框。投投浮窗（`TouTouAssistantCard`）打开时传 `true`：
   * 卡片是常驻面板，浮窗里这一份页面随卡片开关整体重新挂载，所以一个布尔量就够。
   */
  autoFocusComposer?: boolean;
  compact?: boolean;
  surface?: AssistantSurface;
}
