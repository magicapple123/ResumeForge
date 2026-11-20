// SPDX-License-Identifier: Apache-2.0
/** 行内格式预览开关的模块级 store（T01）：默认关、只请求一次、写失败回滚。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInlineFormatPreview, saveInlineFormatPreview } from "../../../api/settings";
import {
  isInlineFormatPreviewEnabled,
  loadInlineFormatPreview,
  resetInlineFormatPreviewForTests,
  setInlineFormatPreview,
  subscribeInlineFormatPreview,
} from "./inlineFormatPreviewStore";

vi.mock("../../../api/settings", () => ({
  getInlineFormatPreview: vi.fn(),
  saveInlineFormatPreview: vi.fn(),
}));

const getMock = vi.mocked(getInlineFormatPreview);
const saveMock = vi.mocked(saveInlineFormatPreview);

beforeEach(() => {
  resetInlineFormatPreviewForTests();
  getMock.mockReset();
  saveMock.mockReset();
});

afterEach(() => {
  resetInlineFormatPreviewForTests();
});

describe("inlineFormatPreviewStore", () => {
  it("默认关（读不到设置时保持旧行为）", () => {
    expect(isInlineFormatPreviewEnabled()).toBe(false);
  });

  it("load 成功后发布服务端值", async () => {
    getMock.mockResolvedValue({ enabled: true });
    await loadInlineFormatPreview();
    expect(isInlineFormatPreviewEnabled()).toBe(true);
  });

  it("load 失败保持 false，不抛错", async () => {
    getMock.mockRejectedValue(new Error("offline"));
    await expect(loadInlineFormatPreview()).resolves.toBeUndefined();
    expect(isInlineFormatPreviewEnabled()).toBe(false);
  });

  it("并发 load 只发一次请求（同屏几十个字段不会各发一次）", async () => {
    getMock.mockResolvedValue({ enabled: true });
    await Promise.all([
      loadInlineFormatPreview(),
      loadInlineFormatPreview(),
      loadInlineFormatPreview(),
    ]);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("已加载后再次 load 不再请求", async () => {
    getMock.mockResolvedValue({ enabled: false });
    await loadInlineFormatPreview();
    await loadInlineFormatPreview();
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("set 乐观更新并通知订阅者", async () => {
    saveMock.mockResolvedValue({ enabled: true });
    const listener = vi.fn();
    const unsubscribe = subscribeInlineFormatPreview(listener);
    await setInlineFormatPreview(true);
    expect(isInlineFormatPreviewEnabled()).toBe(true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("set 写失败回滚到上一值并把错误抛给调用方", async () => {
    saveMock.mockRejectedValue(new Error("500"));
    await expect(setInlineFormatPreview(true)).rejects.toThrow("500");
    expect(isInlineFormatPreviewEnabled()).toBe(false);
  });
});
