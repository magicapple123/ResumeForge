// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台"整体保存"的**唯一**状态机（W02）：单飞、过时回包丢弃、失败保草稿、冲突等人处理。
 *
 * 它只做三件与业务无关的事，具体"先版式后内容"的编排由调用方通过 `perform` 注入：
 *
 * 1. **单飞**：`inFlight` 期间再点保存不发请求，只置一个 `pendingAfter`；当前这一趟结束后
 *    若仍被点过，就**再跑一趟**（不是排队 N 次——排队会让用户点五下、它老老实实写五遍）。
 * 2. **token**：每次开跑自增。回包时 token 已变（文档换了 / 关窗 / 用最新覆盖了本地）就
 *    丢弃这次回包，不 setState——否则一个迟到的成功会把"文档已经换掉"的界面重新标成已保存。
 * 3. **终态**：`saved/unchanged` → idle；`conflict` → 停在冲突态，**不自动重试**（重试就是
 *    硬覆盖）；`failed` → 失败态，dirty 与草稿由调用方原样保留，用户可以再点保存。
 *
 * 为什么失败要停住而不是自动重试：保存失败时用户刚改的内容还在编辑器里，自动重试会在
 * "网络抖动"这类瞬时原因上成功，却也可能在一个真实的 4xx/5xx 上连发请求；把重试交给
 * 用户点那颗还在的保存按钮，既看得见又不吵。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeFromError } from "./saveOutcome";
import type { SaveOutcome } from "./types";

/** `conflict` 不是失败：它要求用户选"用最新的 / 比较 / 另存副本"之一。 */
export type DocumentSaveStatus = "idle" | "saving" | "conflict" | "failed";

export interface UseDocumentSaveOptions {
  /** 一次完整保存（先版式后内容）。返回终态；抛异常按失败处理（冲突码仍识别为冲突）。 */
  perform: () => Promise<SaveOutcome>;
}

export interface DocumentSaveApi {
  status: DocumentSaveStatus;
  /** 这一趟正在跑（按钮 loading / 禁止再点）。 */
  saving: boolean;
  /** 停在冲突态：顶部换成三选一，保存按钮必须禁用（禁止"再点一次硬覆盖"）。 */
  conflict: boolean;
  /** 失败原因（`failed` 时有值）：给日志与可选的提示用，界面文案由调用方决定。 */
  failure: unknown;
  /** 单飞保存入口：在飞时只登记"结束后再来一次"。 */
  save: () => Promise<void>;
  /** 冲突已解决（用最新的 / 另存副本成功）：回到 idle，允许再次保存。 */
  settleConflict: () => void;
  /** 文档被替换或关闭：让在飞回包作废并复位状态。 */
  invalidate: () => void;
}

export function useDocumentSave({ perform }: UseDocumentSaveOptions): DocumentSaveApi {
  const [status, setStatus] = useState<DocumentSaveStatus>("idle");
  const [failure, setFailure] = useState<unknown>(null);
  // Compiler 规范：ref 不允许在渲染期读写，所以"最新一份 perform"在 effect 里同步。
  // 保存一定发生在渲染提交之后（用户点击 / 定时器），读到的永远是最新的一份闭包。
  const performRef = useRef(perform);
  useEffect(() => {
    performRef.current = perform;
  }, [perform]);
  const tokenRef = useRef(0);
  const inFlightRef = useRef(false);
  const pendingAfterRef = useRef(false);
  // 冲突态必须挡住"再点一次保存"：那等于硬覆盖。按钮在界面上也会禁用，但状态机自己也要
  // 拒绝——否则任何新入口（快捷键 / 程序化调用）都能绕过界面把冲突压过去。
  const conflictRef = useRef(false);

  const save = useCallback(async (): Promise<void> => {
    if (conflictRef.current) return;
    if (inFlightRef.current) {
      pendingAfterRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      do {
        pendingAfterRef.current = false;
        const token = ++tokenRef.current;
        setStatus("saving");
        setFailure(null);
        let outcome: SaveOutcome;
        try {
          outcome = await performRef.current();
        } catch (error) {
          // perform 自己没兜住的异常不能变成未处理拒绝（那会让按钮永远转圈）。
          outcome = outcomeFromError(error);
        }
        // 过时回包：文档已经换了（关窗 / 换记录 / 用最新覆盖），这一次的结果不再属于当前文档。
        if (token !== tokenRef.current) continue;
        if (outcome.status === "conflict") {
          conflictRef.current = true;
          setStatus("conflict");
          break;
        }
        if (outcome.status === "failed") {
          setStatus("failed");
          setFailure(outcome.error);
          break;
        }
        setStatus("idle");
      } while (pendingAfterRef.current);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const settleConflict = useCallback(() => {
    conflictRef.current = false;
    setStatus("idle");
    setFailure(null);
  }, []);

  const invalidate = useCallback(() => {
    tokenRef.current += 1;
    pendingAfterRef.current = false;
    conflictRef.current = false;
    setStatus("idle");
    setFailure(null);
  }, []);

  return {
    status,
    saving: status === "saving",
    conflict: status === "conflict",
    failure,
    save,
    settleConflict,
    invalidate,
  };
}
