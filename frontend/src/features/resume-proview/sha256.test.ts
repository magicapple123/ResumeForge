// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

describe("同步 SHA-256（与后端 photo_sha256 同口径）", () => {
  it("已知向量：空串 / abc / 长串", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("a".repeat(1000))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });

  it("data URL 形式的照片字符串：64 位小写十六进制，且与后端契约同形", () => {
    const hash = sha256Hex("data:image/png;base64,AAAA");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("data:image/png;base64,AAAB")).not.toBe(hash);
  });
});
