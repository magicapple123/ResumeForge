// SPDX-License-Identifier: Apache-2.0
/** 内容签名：稳定、对变化敏感、纯函数。 */
import { describe, expect, it } from "vitest";
import { contentSignature } from "./contentSignature";

const CONTENT = {
  name: "林晓样",
  summary: "熟悉 Python 后端开发",
  experience: [{ company: "示例公司", description: ["负责撮合引擎开发"] }],
};

describe("contentSignature", () => {
  it("同一份内容总是得到同一个签名（不依赖时间/随机数）", () => {
    expect(contentSignature(CONTENT)).toBe(contentSignature(CONTENT));
    // 深拷贝（字段顺序一致）同样稳定。
    expect(contentSignature(JSON.parse(JSON.stringify(CONTENT)))).toBe(contentSignature(CONTENT));
  });

  it("字段内容变一个字就变", () => {
    expect(contentSignature({ ...CONTENT, summary: "熟悉 Python 后端开发 " })).not.toBe(
      contentSignature(CONTENT),
    );
    expect(contentSignature({ ...CONTENT, name: "林晓阳" })).not.toBe(contentSignature(CONTENT));
  });

  it("新增/删除字段就变", () => {
    expect(contentSignature({ ...CONTENT, phone: "13800001234" })).not.toBe(
      contentSignature(CONTENT),
    );
  });

  it("空内容也有稳定签名", () => {
    expect(contentSignature({})).toBe(contentSignature({}));
    expect(contentSignature(null)).toBe(contentSignature(null));
    expect(contentSignature({})).not.toBe(contentSignature(null));
  });
});
