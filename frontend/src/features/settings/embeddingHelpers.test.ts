// SPDX-License-Identifier: Apache-2.0
/**
 * `embeddingGuidanceKey()` 的归类契约（常驻回归网）。
 *
 * 为什么单独成文件：这条映射决定"失败后用户看到什么建议"，最容易出的错是**串味**——
 * 本地资产下载地址 404 被远程厂商的「该服务商不提供 embeddings 接口」吃掉（真实现场，
 * 2026-11 修复批）。之前只有组件测试间接覆盖一条，QA 的判定矩阵是仓库外脚本，跑完就没了；
 * 这里把每个分支都固定成一条断言。
 *
 * 表里的中文是**输入数据**（后端 `detail` 原样透传的原因），不是界面文案；本文件是
 * `*.test.ts`，落在 cjkRatchet 的 `src` 口径（非测试源码）与 productCopy AST 的
 * inventory 之外，不会因此让守卫变红。
 */
import { describe, expect, it } from "vitest";
import { embeddingGuidanceKey } from "./embeddingHelpers";

describe("embeddingGuidanceKey", () => {
  it.each([
    // 本地资产：404/410 说的是"源没发布"，5xx 说的是"源坏了"——都不该甩锅给网络，
    // 更不该说成"该服务商不提供 embeddings 接口"。
    [
      "本地模型资产下载源不可用（资源未发布或地址失效，HTTP 404）",
      "embeddingSearch.guidance.source",
    ],
    ["本地模型资产下载源返回 HTTP 503", "embeddingSearch.guidance.source"],
    ["本地 model download source unavailable (HTTP 404)", "embeddingSearch.guidance.source"],
    // 远程厂商真的没有 embeddings 接口：仍然归 endpoint，不能被上面那条吞掉。
    ["HTTP 404 该服务商不提供 embeddings 接口", "embeddingSearch.guidance.endpoint"],
    ["404 not found", "embeddingSearch.guidance.endpoint"],
    // 真网络问题。
    ["本地模型资产下载失败，网络不可用", "embeddingSearch.guidance.network"],
    // 其余既有分支（回归：新增分支不许把它们挤掉）。
    ["401 unauthorized, invalid api key", "embeddingSearch.guidance.key"],
    ["sha256 校验失败", "embeddingSearch.guidance.sha"],
    ["", "embeddingSearch.guidance.retry"],
  ])("把 %s 归到 %s", (reason, expected) => {
    expect(embeddingGuidanceKey(reason)).toBe(expected);
  });

  it("大小写与前后空白不影响归类（后端原因大小写不统一）", () => {
    expect(embeddingGuidanceKey("  NOT FOUND  ")).toBe("embeddingSearch.guidance.endpoint");
    expect(embeddingGuidanceKey("Download Source Unavailable")).toBe(
      "embeddingSearch.guidance.source",
    );
  });
});
