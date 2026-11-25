// SPDX-License-Identifier: Apache-2.0
/**
 * CR-10：服务配置恢复条数。
 *
 * 背景：备份包新增 `global_services.json`，带回语音 / 语义检索 / 联网搜索 / 代理四块。
 * 导入提示必须能说清"回来了几项"——但也不能把空壳算成一项：只存过一条没填地址的语音
 * 配置时，用户看到"恢复了服务配置"会以为一切就绪，直到真正调用才发现是空的。
 */
import { describe, expect, it } from "vitest";
import { countRestoredServices } from "./datasetImportFeedback";

describe("countRestoredServices", () => {
  it("counts every section that actually has content", () => {
    expect(
      countRestoredServices({
        asr_profiles: { imported: 2, skipped: 0 },
        embedding_profiles: { imported: 1 },
        web_search: true,
        network: true,
      }),
    ).toBe(4);
  });

  it("ignores sections that came back empty", () => {
    expect(
      countRestoredServices({
        asr_profiles: { imported: 0, skipped: 1 },
        embedding_profiles: { imported: 0 },
        web_search: false,
        network: false,
      }),
    ).toBe(0);
  });

  it("returns 0 when the archive carries no service section at all", () => {
    expect(countRestoredServices(undefined)).toBe(0);
  });
});
