// SPDX-License-Identifier: Apache-2.0
/**
 * 页面感知（#27B）：注册表合并规则、**18 条路由逐页都有动作**（从 APP_ROOT_ROUTE 反推，
 * 新增路由漏登记会点名）、以及信号合成（溢出 / 队列 / 资料 / 未保存）。
 */
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { APP_ROOT_ROUTE } from "../../appRoutes";
import { buildRoutePageContext, routeActionIds, TOU_TOU_ROUTE_PATHS } from "./touTouRouteCatalog";
import {
  getTouTouPageContext,
  mergeTouTouPageContexts,
  registerTouTouContext,
  resetTouTouContextRegistry,
  setTouTouSignals,
} from "./touTouPageContext";
import {
  countMissingProfileFields,
  countUnsupportedQueueSources,
  deriveTouTouSignals,
} from "./useTouTouSignals";

function routePathsFromAppRoutes(): string[] {
  const children = (APP_ROOT_ROUTE.props as { children: ReactElement[] }).children;
  return children
    .map((child) => (child.props as { path?: string }).path ?? "")
    .filter((path) => path !== "" && path !== "*");
}

describe("18 条路由都有本页动作", () => {
  const paths = routePathsFromAppRoutes();

  it("路由表里确实有 19 条业务路由（交接书的 18 = 根路由之外的 18 个子页）", () => {
    expect(paths.length).toBe(19);
  });

  it("每条路由都登记了动作（3–5 个，面板只展示前 5 个）", () => {
    const missing: string[] = [];
    for (const path of paths) {
      const ids = routeActionIds(path);
      if (ids.length < 3 || ids.length > 5) missing.push(`${path}: ${ids.length}`);
    }
    expect(missing).toEqual([]);
  });

  it("子路由不会被父路由抢走：/claims/drill 与 /resumes/external 命中的是自己", () => {
    expect(routeActionIds("/claims/drill")).toContain("go-claims");
    expect(routeActionIds("/claims")).not.toContain("go-claims");
    expect(routeActionIds("/resumes/external")).toContain("go-resumes");
  });

  it("每条路由的上下文都有标题与动作", () => {
    for (const path of paths) {
      const context = buildRoutePageContext(path);
      expect(context.titleKey).toBeTruthy();
      expect(context.actions.length).toBeGreaterThan(0);
    }
    // 已登记路由清单与路由表一一对应（反向：登记了但路由不存在也是错误）。
    expect([...TOU_TOU_ROUTE_PATHS].sort()).toEqual([...paths].sort());
  });
});

describe("注册表合并", () => {
  it("多个注册方按 id 去重，后注册的覆盖先注册的", () => {
    resetTouTouContextRegistry();
    const unregisterPage = registerTouTouContext({
      id: "page",
      titleKey: "touTou.panel.title",
      actions: [
        { id: "open-assistant", labelKey: "touTou.action.openAssistant" },
        { id: "page-action", labelKey: "touTou.action.sideAsk" },
      ],
      signals: [
        { id: "s1", kind: "layout-overflow", messageKey: "touTou.signal.layoutOverflow.title" },
      ],
    });
    const unregisterFeature = registerTouTouContext({
      id: "feature",
      signals: [
        { id: "s2", kind: "queue-unsupported", messageKey: "touTou.signal.queueUnsupported.title" },
        { id: "s1", kind: "resume-unsaved", messageKey: "touTou.signal.resumeUnsaved.title" },
      ],
    });

    const merged = getTouTouPageContext();
    expect(merged.titleKey).toBe("touTou.panel.title");
    expect(merged.actions.map((action) => action.id)).toEqual(["open-assistant", "page-action"]);
    // 同 id 信号被后注册的覆盖，且位置按"删旧再插"落在最后。
    expect(merged.signals.map((signal) => signal.id)).toEqual(["s2", "s1"]);
    expect(merged.signals.find((signal) => signal.id === "s1")?.kind).toBe("resume-unsaved");

    unregisterFeature();
    expect(getTouTouPageContext().signals.map((signal) => signal.id)).toEqual(["s1"]);
    unregisterPage();
    expect(getTouTouPageContext()).toEqual({ titleKey: null, actions: [], signals: [] });
  });

  it("同一 id 重复注册按覆盖处理；旧 cleanup 不会删掉新注册", () => {
    resetTouTouContextRegistry();
    const first = registerTouTouContext({
      id: "page",
      actions: [{ id: "a", labelKey: "touTou.action.sideAsk" }],
    });
    const second = registerTouTouContext({
      id: "page",
      actions: [{ id: "b", labelKey: "touTou.action.openAssistant" }],
    });
    first(); // 旧卸载：不能把新注册一起删掉
    expect(getTouTouPageContext().actions.map((action) => action.id)).toEqual(["b"]);
    second();
    expect(getTouTouPageContext().actions).toEqual([]);
  });

  it("setTouTouSignals 只更新信号，保留该注册方已有的标题/动作", () => {
    resetTouTouContextRegistry();
    registerTouTouContext({
      id: "page",
      titleKey: "touTou.panel.title",
      actions: [{ id: "a", labelKey: "touTou.action.sideAsk" }],
    });
    setTouTouSignals("page", [
      { id: "s1", kind: "layout-overflow", messageKey: "touTou.signal.layoutOverflow.title" },
    ]);
    const merged = getTouTouPageContext();
    expect(merged.titleKey).toBe("touTou.panel.title");
    expect(merged.actions).toHaveLength(1);
    expect(merged.signals).toHaveLength(1);
    resetTouTouContextRegistry();
  });

  it("mergeTouTouPageContexts 不接受空输入时报空上下文", () => {
    expect(mergeTouTouPageContexts([null, undefined, {}])).toEqual({
      titleKey: null,
      actions: [],
      signals: [],
    });
  });
});

describe("信号合成（与 #24 共用同一次测量）", () => {
  const EMPTY_WORKBENCH = { measure: null, layoutStatus: null };
  const base = {
    saveControl: null,
    workbench: EMPTY_WORKBENCH,
    queueUnsupported: 0,
    profileMissing: 0,
    registered: [],
  };

  it("没有任何来源时信号为空（球保持安静）", () => {
    expect(deriveTouTouSignals(base)).toEqual([]);
  });

  it("资料未保存只 pulse 不出气泡（announce=false，保存卡已经在说话）", () => {
    const signals = deriveTouTouSignals({
      ...base,
      saveControl: { onSave: () => undefined, onCancel: () => undefined },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "resume-unsaved", announce: false });
  });

  it("制作台测量溢出 → layout-overflow，页数来自 #24 的同一次本地测量", () => {
    const signals = deriveTouTouSignals({
      ...base,
      workbench: {
        measure: { usedHeight: 2_100, pageContentHeight: 1_000, pageLimit: 1 },
        layoutStatus: null,
      },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: "layout-overflow",
      count: 3,
      params: { needed: 3, limit: 1 },
    });
  });

  it("画布已判定溢出时即使本地取整刚好 100% 也报信号", () => {
    const signals = deriveTouTouSignals({
      ...base,
      workbench: {
        measure: { usedHeight: 1_000, pageContentHeight: 1_000, pageLimit: 1 },
        layoutStatus: {
          pages: 1,
          overflow: true,
          pagesNeeded: 1,
          pagesRendered: 1,
        },
      },
    });
    expect(signals.map((signal) => signal.kind)).toEqual(["layout-overflow"]);
  });

  it("队列来源不支持 / 资料缺字段 → 带跳转动作的信号", () => {
    const signals = deriveTouTouSignals({ ...base, queueUnsupported: 3, profileMissing: 2 });
    expect(signals.map((signal) => signal.kind)).toEqual([
      "queue-unsupported",
      "profile-missing-fields",
    ]);
    expect(signals[0].actionId).toBe("go-apply");
    expect(signals[1].actionId).toBe("go-profile");
    expect(signals[0].params).toEqual({ count: 3 });
  });

  it("页面自己登记的同 id 信号覆盖内置来源", () => {
    const signals = deriveTouTouSignals({
      ...base,
      queueUnsupported: 3,
      registered: [
        {
          id: "queue-unsupported",
          kind: "queue-unsupported",
          messageKey: "touTou.signal.queueUnsupported.title",
          params: { count: 9 },
        },
      ],
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].params).toEqual({ count: 9 });
  });
});

describe("信号计数纯函数", () => {
  it("队列按 apply_supported === false 计数（缺失按支持，不当成不支持）", () => {
    expect(
      countUnsupportedQueueSources([
        { apply_supported: false },
        { apply_supported: true },
        {},
        { apply_supported: false },
      ]),
    ).toBe(2);
  });

  it("资料缺字段：空串与空列表都算缺", () => {
    expect(
      countMissingProfileFields({
        name: "张三",
        phone: "13800000000",
        email: "",
        job_intent: "后端",
        educations: [{ school: "浙江大学" }],
        experiences: [],
      }),
    ).toBe(2);
  });
});
