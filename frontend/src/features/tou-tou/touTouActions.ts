// SPDX-License-Identifier: Apache-2.0
/**
 * 投投的动作目录（#27C）。
 *
 * 一个动作 = 稳定 id + 文案 key + 执行函数。动作目录是**全站唯一清单**：动作面板里的
 * "本页动作"是它的子集（按路由挑），"搜索全部"直接搜它。70 个工具不往面板里塞按钮，
 * 面板负责的是"这一页最该做的几件事"。
 *
 * 为什么执行函数吃一个 runtime 对象：动作本身不该知道球怎么开卡片、路由怎么跳。
 * 这些副作用由 `TouTouOrb` 组装成 runtime 传进来，动作表因此可以脱离 React 单测。
 */
import type { MessageKey } from "../../i18n";
import type { TouTouAction } from "./touTouPageContext";

export type TouTouActionId =
  | "open-assistant"
  | "side-ask"
  | "open-clipboard"
  | "go-jobs"
  | "go-apply"
  | "go-resumes"
  | "go-profile"
  | "go-materials"
  | "go-knowledge"
  | "go-favorites"
  | "go-interview"
  | "go-claims"
  | "go-tracker";

/** 动作执行所需的宿主能力。全部由球注入，动作表本身是纯数据。 */
export interface TouTouActionRuntime {
  openAssistant: () => void;
  openClipboard: () => void;
  /** 打开动作面板并聚焦侧问输入框。 */
  openSideAsk: () => void;
  navigate: (path: string) => void;
}

export interface TouTouActionDefinition extends TouTouAction {
  run: (runtime: TouTouActionRuntime) => void;
}

const DEFINITIONS: Record<TouTouActionId, TouTouActionDefinition> = {
  "open-assistant": {
    id: "open-assistant",
    labelKey: "touTou.action.openAssistant",
    run: (runtime) => runtime.openAssistant(),
  },
  "side-ask": {
    id: "side-ask",
    labelKey: "touTou.action.sideAsk",
    run: (runtime) => runtime.openSideAsk(),
  },
  "open-clipboard": {
    id: "open-clipboard",
    labelKey: "touTou.action.openClipboard",
    run: (runtime) => runtime.openClipboard(),
  },
  "go-jobs": {
    id: "go-jobs",
    labelKey: "touTou.action.goJobs",
    run: (runtime) => runtime.navigate("/jobs"),
  },
  "go-apply": {
    id: "go-apply",
    labelKey: "touTou.action.goApply",
    run: (runtime) => runtime.navigate("/apply"),
  },
  "go-resumes": {
    id: "go-resumes",
    labelKey: "touTou.action.goResumes",
    run: (runtime) => runtime.navigate("/resumes"),
  },
  "go-profile": {
    id: "go-profile",
    labelKey: "touTou.action.goProfile",
    run: (runtime) => runtime.navigate("/profile"),
  },
  "go-materials": {
    id: "go-materials",
    labelKey: "touTou.action.goMaterials",
    run: (runtime) => runtime.navigate("/materials"),
  },
  "go-knowledge": {
    id: "go-knowledge",
    labelKey: "touTou.action.goKnowledge",
    run: (runtime) => runtime.navigate("/knowledge"),
  },
  "go-favorites": {
    id: "go-favorites",
    labelKey: "touTou.action.goFavorites",
    run: (runtime) => runtime.navigate("/favorites"),
  },
  "go-interview": {
    id: "go-interview",
    labelKey: "touTou.action.goInterview",
    run: (runtime) => runtime.navigate("/interview"),
  },
  "go-claims": {
    id: "go-claims",
    labelKey: "touTou.action.goClaims",
    run: (runtime) => runtime.navigate("/claims"),
  },
  "go-tracker": {
    id: "go-tracker",
    labelKey: "touTou.action.goTracker",
    run: (runtime) => runtime.navigate("/tracker"),
  },
};

/** 全部动作（面板"搜索全部"的数据源）。顺序即无搜索结果时的展示顺序。 */
export const TOU_TOU_ACTIONS: readonly TouTouActionDefinition[] = Object.values(DEFINITIONS);

/** 按 id 取动作；未知 id 返回 undefined（旧注册表里的脏数据不崩）。 */
export function touTouActionById(id: string): TouTouActionDefinition | undefined {
  return (DEFINITIONS as Record<string, TouTouActionDefinition>)[id];
}

/** 把 id 列表解析成动作列表，跳过未知 id。 */
export function resolveTouTouActions(ids: readonly string[]): TouTouAction[] {
  const actions: TouTouAction[] = [];
  for (const id of ids) {
    const definition = touTouActionById(id);
    if (definition) actions.push({ id: definition.id, labelKey: definition.labelKey });
  }
  return actions;
}

/** 面板搜索：不区分大小写地匹配当前语言标签。 */
export function searchTouTouActions(
  query: string,
  labelOf: (key: MessageKey) => string,
): readonly TouTouActionDefinition[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return TOU_TOU_ACTIONS;
  return TOU_TOU_ACTIONS.filter((action) =>
    labelOf(action.labelKey).toLocaleLowerCase().includes(keyword),
  );
}
