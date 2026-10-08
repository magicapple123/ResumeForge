/** 资料保存桥：注册 / 清空 / 订阅通知的最小契约测试。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProfileSaveControl,
  setProfileSaveControl,
  subscribeProfileSaveControl,
  type ProfileSaveControl,
} from "./profileSaveBridge";

// 模块级单例状态：每个用例结束都清空，避免泄漏到同文件后续用例。
afterEach(() => {
  setProfileSaveControl(null);
});

describe("profileSaveBridge", () => {
  it("starts with no control registered", () => {
    expect(getProfileSaveControl()).toBeNull();
  });

  it("exposes the registered control and clears it on null", () => {
    const control: ProfileSaveControl = { onSave: vi.fn(), onCancel: vi.fn() };

    setProfileSaveControl(control);
    expect(getProfileSaveControl()).toBe(control);

    // 页面保存/取消完成后传 null 收起，悬浮球随之撤卡。
    setProfileSaveControl(null);
    expect(getProfileSaveControl()).toBeNull();
  });

  it("keeps the latest control when registered twice", () => {
    const first: ProfileSaveControl = { onSave: vi.fn(), onCancel: vi.fn() };
    const second: ProfileSaveControl = { onSave: vi.fn(), onCancel: vi.fn(), saving: true };

    setProfileSaveControl(first);
    setProfileSaveControl(second);

    expect(getProfileSaveControl()).toBe(second);
  });

  it("notifies subscribers on every change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProfileSaveControl(listener);

    setProfileSaveControl({ onSave: vi.fn(), onCancel: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(1);

    setProfileSaveControl(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setProfileSaveControl({ onSave: vi.fn(), onCancel: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("supports multiple subscribers and removes only the one unsubscribed", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = subscribeProfileSaveControl(listenerA);
    subscribeProfileSaveControl(listenerB);

    setProfileSaveControl({ onSave: vi.fn(), onCancel: vi.fn() });
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    unsubscribeA();
    setProfileSaveControl(null);
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(2);
  });
});
