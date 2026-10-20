// SPDX-License-Identifier: Apache-2.0
/** 备份包默认下载名：`<名字>-YYYYMMDD-HHMMSS`（与后端同名规则）。 */
import { describe, expect, it } from "vitest";
import { defaultExportName } from "./exportNaming";

describe("defaultExportName", () => {
  it("拼出数据集名 + 本地时间戳", () => {
    const now = new Date(2026, 9, 19, 10, 15, 0); // 2026-10-19 10:15:00
    expect(defaultExportName("校招线", now)).toBe("校招线-20261019-101500");
  });

  it("月/日/时/分/秒都补零", () => {
    const now = new Date(2026, 0, 2, 3, 4, 5);
    expect(defaultExportName("全部数据集", now)).toBe("全部数据集-20260102-030405");
  });
});
