// SPDX-License-Identifier: Apache-2.0
/**
 * **测试专用**：把"一次请求"接到统一任务契约上的桥。
 *
 * ## 它替的是什么
 *
 * 入口 store 现在只跟 `utils/aiTaskEntry` 打交道（`startAiTask` / `cancelAiTaskEntry` /
 * `attachAiTaskUi`）。组件测试想验的是**界面语义**（点了才跑、取消就停、走了才通知），
 * 不该顺带把任务地基的轮询再测一遍（那由 `utils/backgroundTasks*.test.ts` 负责）。
 *
 * 所以这里给出一个"立刻执行、立刻交付"的替身：
 * - `startAiTask` 调一次测试给的 `run(payload, signal)`（内部就是被 mock 掉的老 API），
 *   resolve 后按新契约把结果**派发**进 `utils/aiTaskResultSink`，reject 则走 `onFinished`；
 * - `cancelAiTaskEntry` **真的 abort** 那个 signal，并按"后端把状态落成 canceled"的语义
 *   回调 `onFinished`——於是组件测试里"abort 置真"这类断言仍然成立，且验的是新链路；
 * - `attachAiTaskUi` 记账，测试可以断言"有人在看 / 没人看"。
 *
 * 它不做轮询、不写 localStorage：这两件事属于任务地基，别在组件测试里重复验。
 */
import { dispatchAiTaskResult } from "../utils/aiTaskResultSink";
import type { BackgroundTask } from "../utils/backgroundTasks.types";

export interface AiTaskEntryBridgeSpec {
  /** 真正跑一次生成（通常是被 mock 掉的老 API 调用）。返回 `result_ref` 形状的负载。 */
  run: (payload: Record<string, unknown>, signal: AbortSignal) => Promise<Record<string, unknown>>;
}

/** 一份终态任务快照（store 只读 `status` 与 `error`，其余给类型看）。 */
function terminalTask(status: BackgroundTask["status"], error = ""): BackgroundTask {
  return {
    key: "bridge#0",
    kind: "bridge",
    id: 0,
    label: "",
    status,
    message: "",
    progressPercent: null,
    receivedChars: 0,
    resumeId: null,
    refId: null,
    deepLink: null,
    resultData: null,
    error,
    unknown: false,
  };
}

export interface AiTaskEntryBridge {
  startAiTask: (input: {
    kind: string;
    payload: Record<string, unknown>;
    label: string;
    onFinished?: (task: BackgroundTask) => void;
  }) => Promise<{ id: number; key: string }>;
  cancelAiTaskEntry: (key: string) => Promise<void>;
  attachAiTaskUi: (key: string) => () => void;
  aiTaskKey: (kind: string, id: number) => string;
  /** 当前"有人在看"的任务主键（测试断言用）。 */
  attachedKeys: () => string[];
}

export function createAiTaskEntryBridge(spec: AiTaskEntryBridgeSpec): AiTaskEntryBridge {
  let sequence = 0;
  const controllers = new Map<string, AbortController>();
  const finished = new Map<string, ((task: BackgroundTask) => void) | undefined>();
  const attached = new Set<string>();

  return {
    async startAiTask(input) {
      const id = ++sequence;
      const key = `${input.kind}#${id}`;
      const controller = new AbortController();
      controllers.set(key, controller);
      finished.set(key, input.onFinished);
      void spec.run(input.payload, controller.signal).then(
        (resultRef) => {
          // 成功：与真实链路一样经 sink 交付（刷新恢复时也是这条路）。
          dispatchAiTaskResult(input.kind, id, resultRef);
        },
        (error: unknown) => {
          // 被取消后 reject 的老 API 会带着"已取消"回来：那不是失败，别把界面写成错误态
          // （真实链路里后端把任务落成 canceled，也不会走 failed）。
          if (controller.signal.aborted) {
            input.onFinished?.(terminalTask("cancelled"));
            return;
          }
          input.onFinished?.(terminalTask("failed", error instanceof Error ? error.message : ""));
        },
      );
      return { id, key };
    },
    async cancelAiTaskEntry(key) {
      const controller = controllers.get(key);
      if (!controller) return;
      controllers.delete(key);
      // 真停：与真实取消一致——先打断在途调用，再由后端落 canceled 触发收尾。
      controller.abort();
      finished.get(key)?.(terminalTask("cancelled"));
    },
    attachAiTaskUi(key) {
      attached.add(key);
      return () => {
        attached.delete(key);
      };
    },
    aiTaskKey(kind, id) {
      return `${kind}#${id}`;
    },
    attachedKeys() {
      return [...attached];
    },
  };
}
