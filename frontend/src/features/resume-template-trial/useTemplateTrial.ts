// SPDX-License-Identifier: Apache-2.0
/**
 * W10 试模板的会话状态：左/右模板、预览内容模式、覆盖策略、两侧的预览与真实测量。
 *
 * ## 不改文档
 *
 * 这个 hook **没有任何写回布局的出口**。试用只产生"看到的东西"；采纳由宿主的
 * `onTrialAdopt` 触发一次 layout 变更（进入统一历史），取消/关闭把临时状态丢掉即可。
 *
 * ## 竞态
 *
 * 每一轮取数带世代号 + AbortController：换模板/换内容/换覆盖策略/关视图都会掐掉在飞的
 * 请求，慢回来的旧图不允许覆盖新状态（与模板图库缩略图同一套做法）。
 *
 * ## 示例内容不测页数
 *
 * 只有"我的内容 + 有简历 id"才测量（见 `trialRequests.measureOptions`）；示例模式
 * 两侧只渲染外观，界面显示"示例内容不测页数"。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeDocument, ResumeLayout, ResumeTemplateCatalog } from "../../types";
import { contentSignature } from "../../utils/contentSignature";
import { templateChoices } from "./templateProfile";
import { fetchTrialPreview, measureTrial } from "./trialRequests";
import type { TrialContentMode, TrialRequestContext, TrialSide, TrialSideState } from "./types";

function emptySide(template: string): TrialSideState {
  return {
    template,
    html: "",
    htmlLoading: true,
    htmlError: null,
    measurement: null,
    measureLoading: false,
    measureError: null,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export interface UseTemplateTrialArgs {
  open: boolean;
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  resumeId?: number | null;
  content?: ResumeDocument | null;
  /** 从图库某张卡片点"试用"进来时指定右侧模板。 */
  initialTemplate?: string | null;
}

export interface UseTemplateTrial {
  choices: ReturnType<typeof templateChoices>;
  mode: TrialContentMode;
  setMode: (mode: TrialContentMode) => void;
  currentAvailable: boolean;
  useOverrides: boolean;
  setUseOverrides: (value: boolean) => void;
  left: string;
  right: string;
  setSideTemplate: (side: TrialSide, template: string) => void;
  states: Record<TrialSide, TrialSideState>;
  retry: (side?: TrialSide) => void;
  reset: () => void;
  /** 是否在测页数（界面据此显示测量位/说明）。 */
  measureEnabled: boolean;
}

export function useTemplateTrial({
  open,
  layout,
  catalog,
  resumeId,
  content,
  initialTemplate,
}: UseTemplateTrialArgs): UseTemplateTrial {
  const choices = templateChoices(catalog, layout.template);
  const fallbackRight =
    choices.find((item) => item.name !== layout.template)?.name ?? layout.template;
  const resumeAvailable = Boolean(resumeId || content);

  const [mode, setModeState] = useState<TrialContentMode>("demo");
  const [useOverrides, setUseOverrides] = useState(true);
  const [left, setLeft] = useState(layout.template);
  const [right, setRight] = useState(fallbackRight);
  const [retryTick, setRetryTick] = useState(0);
  const [states, setStates] = useState<Record<TrialSide, TrialSideState>>({
    left: emptySide(layout.template),
    right: emptySide(fallbackRight),
  });
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  // 首次挂载（对比视图是条件渲染，每次进入都是新会话）：默认"当前模板 vs 第一个其它
  // 模板"，有简历内容时默认看"我的内容"；从某张卡片点"试用"进来时右侧就是那张卡。
  const [bootstrapped, setBootstrapped] = useState(false);
  if (!bootstrapped) {
    setBootstrapped(true);
    if (initialTemplate && initialTemplate !== layout.template) setRight(initialTemplate);
    setModeState(resumeAvailable ? "current" : "demo");
  }

  // 弹窗重新打开（未卸载的宿主）：与首次挂载同样的默认值。
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      const initialRight =
        initialTemplate && initialTemplate !== layout.template ? initialTemplate : fallbackRight;
      setLeft(layout.template);
      setRight(initialRight);
      setModeState(resumeAvailable ? "current" : "demo");
      setUseOverrides(true);
      setStates({
        left: emptySide(layout.template),
        right: emptySide(initialRight),
      });
    }
  }
  // 目录晚到 / 右侧与左侧撞成同一套：补一个不同的右侧（不改用户已选的）。
  if (open && right === left && fallbackRight !== left) setRight(fallbackRight);

  const measureEnabled = mode === "current" && Boolean(resumeId);
  const formatConfigKey = JSON.stringify(layout.format_config ?? {});
  const contentKey = content ? contentSignature(content) : "";
  const requestKey = [
    open,
    mode,
    left,
    right,
    useOverrides,
    layout.format_name,
    formatConfigKey,
    String(layout.page_limit),
    layout.font_scale,
    resumeId ?? "",
    contentKey,
    retryTick,
  ].join("|");

  const [prevRequestKey, setPrevRequestKey] = useState(requestKey);
  if (prevRequestKey !== requestKey) {
    setPrevRequestKey(requestKey);
    if (open) {
      // 模板变了就清掉旧 HTML（不能把 A 模板的图挂在 B 模板名下）；内容/参数变化保留旧图先看。
      setStates((prev) => ({
        left: {
          ...prev.left,
          template: left,
          html: left === prev.left.template ? prev.left.html : "",
          htmlLoading: true,
          htmlError: null,
          measureLoading: measureEnabled,
          measureError: null,
          measurement: null,
        },
        right: {
          ...prev.right,
          template: right,
          html: right === prev.right.template ? prev.right.html : "",
          htmlLoading: true,
          htmlError: null,
          measureLoading: measureEnabled,
          measureError: null,
          measurement: null,
        },
      }));
    }
  }

  useEffect(() => {
    if (!open) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;
    const context: TrialRequestContext = { mode, layout, resumeId, content };
    const sides: { side: TrialSide; template: string }[] = [
      { side: "left", template: left },
      { side: "right", template: right },
    ];
    const write = (side: TrialSide, patch: Partial<TrialSideState>) => {
      if (cancelled || generationRef.current !== generation) return;
      setStates((prev) => ({ ...prev, [side]: { ...prev[side], ...patch } }));
    };
    for (const { side, template } of sides) {
      const input = { context, template, useOverrides };
      void (async () => {
        try {
          const html = await fetchTrialPreview(input, controller.signal);
          write(side, { html, htmlLoading: false, htmlError: null, template });
        } catch (error) {
          if (controller.signal.aborted) return;
          write(side, { htmlLoading: false, htmlError: errorText(error) });
        }
      })();
      if (measureEnabled) {
        void (async () => {
          try {
            const measurement = await measureTrial(input, controller.signal);
            write(side, { measurement, measureLoading: false, measureError: null });
          } catch (error) {
            if (controller.signal.aborted) return;
            write(side, { measureLoading: false, measureError: errorText(error) });
          }
        })();
      }
    }
    return () => {
      cancelled = true;
      controller.abort();
    };
    // 依赖已全部折进 requestKey（layout/content 走签名），避免对象引用抖动导致反复取数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestKey]);

  const setMode = useCallback(
    (next: TrialContentMode) => {
      if (next === "current" && !resumeAvailable) return;
      setModeState(next);
    },
    [resumeAvailable],
  );

  const setSideTemplate = useCallback((side: TrialSide, template: string) => {
    if (side === "left") setLeft(template);
    else setRight(template);
  }, []);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    setStates({
      left: emptySide(layout.template),
      right: emptySide(fallbackRight),
    });
  }, [layout.template, fallbackRight]);

  return {
    choices,
    mode,
    setMode,
    currentAvailable: resumeAvailable,
    useOverrides,
    setUseOverrides,
    left,
    right,
    setSideTemplate,
    states,
    retry,
    reset,
    measureEnabled,
  };
}
