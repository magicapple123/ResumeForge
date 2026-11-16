// SPDX-License-Identifier: Apache-2.0
/**
 * I-07：设置页麦克风一行的三态渲染与刷新链路。
 *
 * 钉住的四件事（都是"看起来能用、实际不能用"的那类）：
 * 1. 未授权时必须**真的有一个授权按钮**，且与提示同排——原来只有一句"首次授权后才会
 *    显示设备名称"，而浏览器不允许后台自动弹授权框，等于这条路不存在；
 * 2. 点授权后立刻重新枚举设备（不点刷新也能看到真实设备名），且取流后**马上停轨**
 *    （指示灯必须灭）；
 * 3. 被拒绝时给 `denied` 的解除路径，而不是"不可用"；
 * 4. `permissions.query` 抛 `TypeError` 的环境要能回退，且 `devicechange` /
 *    测试弹层关闭都会触发重拉。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import MicSettingsRow from "./MicSettingsRow";
import type { AudioInputDevice } from "./voicePrefs";

type PermissionStateName = "granted" | "prompt" | "denied";

interface MicHarness {
  enumerateDevices: ReturnType<typeof vi.fn>;
  getUserMedia: ReturnType<typeof vi.fn>;
  setDevices: (next: AudioInputDevice[]) => void;
  setPermissionState: (next: PermissionStateName) => void;
  emitDeviceChange: () => void;
  stopCount: () => number;
}

/** 标签查询用的语言包 key（测试里不写中文断言：测试口径的中文也要计入存量）。 */
const GRANT = t("voiceInput.settings.device.grant");
const REGRANT = t("voiceInput.settings.device.regrant");
const SELECT_ARIA = t("voiceInput.settings.device.aria");
const MIC_TEST_OPEN = t("voiceInput.settings.micTest.open");

/**
 * 带图标的按钮，无障碍名里会拼上图标的 `aria-label`（如「safety-certificate 授权
 * 麦克风」），所以精确匹配找不到它——统一按包含匹配。
 */
function named(label: string): RegExp {
  return new RegExp(label);
}

/**
 * 装一套可控的 `navigator.mediaDevices` / `navigator.permissions`。
 *
 * `devices` 是**可变状态**：真实浏览器在授权前后返回的是同一批设备、不同的 `label`，
 * 用例靠 `setDevices()` 模拟"用户在系统授权框点了允许之后才能读到设备名"。
 */
function installMic(options: {
  devices: AudioInputDevice[];
  permission: PermissionStateName | "throw";
  grant?: "allow" | "deny";
}): MicHarness {
  const state = { devices: [...options.devices], stopped: 0 };

  const permissionListeners = new Set<() => void>();
  const permissionStatus = {
    state: options.permission === "throw" ? "prompt" : options.permission,
    onchange: null as (() => void) | null,
    addEventListener: (_type: "change", handler: () => void) => {
      permissionListeners.add(handler);
    },
    removeEventListener: (_type: "change", handler: () => void) => {
      permissionListeners.delete(handler);
    },
  };
  const query = vi.fn(async () => {
    // Safari / 部分 Chromium 版本不认 "microphone" 这个 PermissionName。
    if (options.permission === "throw") throw new TypeError("unsupported permission name");
    return permissionStatus;
  });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query } });

  const deviceChangeListeners = new Set<() => void>();
  const enumerateDevices = vi.fn(async () =>
    state.devices.map((device) => ({
      kind: "audioinput",
      deviceId: device.deviceId,
      label: device.label,
    })),
  );
  const grantMode = options.grant ?? "allow";
  const getUserMedia = vi.fn(async () => {
    if (grantMode === "deny") {
      const denied = new Error("permission denied");
      denied.name = "NotAllowedError";
      throw denied;
    }
    const track = {
      stop: () => {
        state.stopped += 1;
      },
    };
    return { getTracks: () => [track] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices,
      getUserMedia,
      addEventListener: (_type: string, handler: () => void) => {
        deviceChangeListeners.add(handler);
      },
      removeEventListener: (_type: string, handler: () => void) => {
        deviceChangeListeners.delete(handler);
      },
    },
  });

  return {
    enumerateDevices,
    getUserMedia,
    setDevices: (next) => {
      state.devices = [...next];
    },
    setPermissionState: (next) => {
      permissionStatus.state = next;
      permissionListeners.forEach((handler) => handler());
      permissionStatus.onchange?.();
    },
    emitDeviceChange: () => {
      deviceChangeListeners.forEach((handler) => handler());
    },
    stopCount: () => state.stopped,
  };
}

/** 打开设备下拉并读出候选文案（antd 6 的选项是 `div.ant-select-item-option`）。 */
async function readOptions(): Promise<string[]> {
  fireEvent.mouseDown(screen.getByLabelText(SELECT_ARIA));
  await waitFor(() =>
    expect(document.querySelectorAll(".ant-select-item-option").length).toBeGreaterThan(0),
  );
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).map(
    (option) => option.textContent ?? "",
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(navigator, "permissions");
});

describe("interview-voice/MicSettingsRow 授权入口", () => {
  it("未授权：提示与授权按钮同时出现，且按钮是真实可点的入口", async () => {
    installMic({
      devices: [{ deviceId: "default", label: "" }],
      permission: "prompt",
    });
    render(<MicSettingsRow />);

    expect(await screen.findByText(t("voiceInput.settings.device.prompt"))).toBeInTheDocument();
    const grant = screen.getByRole("button", { name: named(GRANT) });
    expect(grant).toBeEnabled();
    // 不加授权入口时，用户唯一的出路是"先去点测试麦克风"，那正是 I-07 的问题。
    expect(screen.queryByRole("button", { name: named(REGRANT) })).toBeNull();
  });

  it("点授权：取流 → 立刻停轨 → 下拉直接出现真实设备名（不需要手动刷新）", async () => {
    const mic = installMic({
      devices: [{ deviceId: "default", label: "" }],
      permission: "prompt",
    });
    render(<MicSettingsRow />);

    const grant = await screen.findByRole("button", { name: named(GRANT) });
    // 授权一旦被允许，浏览器就能读到设备名了——把这一步排在点击之前，等价于"用户在系统
    // 授权框点了允许"这个瞬间（之后组件必须自己去重拉，而不是等用户点刷新）。
    mic.setDevices([{ deviceId: "mic-1", label: "USB Microphone" }]);
    fireEvent.click(grant);

    await waitFor(() => expect(mic.getUserMedia).toHaveBeenCalledTimes(1));
    // 指示灯必须马上灭：授权按钮不是录音入口。
    await waitFor(() => expect(mic.stopCount()).toBe(1));

    await waitFor(() => expect(mic.enumerateDevices.mock.calls.length).toBeGreaterThan(1));
    // 已授权 → 入口收起，提示改为不再需要解释。
    await waitFor(() => expect(screen.queryByRole("button", { name: named(GRANT) })).toBeNull());

    expect(await readOptions()).toContain("USB Microphone");
  });

  it("拒绝授权：给解除路径（denied 说明 + 重新检查权限 + 具体错误）", async () => {
    installMic({ devices: [], permission: "prompt", grant: "deny" });
    render(<MicSettingsRow />);

    fireEvent.click(await screen.findByRole("button", { name: named(GRANT) }));

    expect(await screen.findByText(t("voiceInput.settings.device.denied"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: named(REGRANT) })).toBeInTheDocument();
    // 失败原因复用 voiceErrors 的分类文案：说明发生了什么 + 怎么办。
    expect(screen.getByText(t("voiceInput.error.permissionDenied"))).toBeInTheDocument();
  });

  it("权限 API 抛 TypeError 时按设备名判空（有真实设备名 = 已授权，不崩）", async () => {
    installMic({
      devices: [{ deviceId: "mic-1", label: "USB Microphone" }],
      permission: "throw",
    });
    render(<MicSettingsRow />);

    await waitFor(() => expect(screen.queryByRole("button", { name: named(GRANT) })).toBeNull());
    expect(screen.queryByText(t("voiceInput.settings.device.denied"))).toBeNull();
  });

  it("权限 API 抛 TypeError 且设备无名时仍给授权入口（回退不吞掉唯一出路）", async () => {
    installMic({ devices: [{ deviceId: "default", label: "" }], permission: "throw" });
    render(<MicSettingsRow />);

    expect(await screen.findByRole("button", { name: named(GRANT) })).toBeInTheDocument();
  });

  it("权限在别处被解除后立刻回到已授权态并重拉设备名", async () => {
    const mic = installMic({ devices: [{ deviceId: "default", label: "" }], permission: "denied" });
    render(<MicSettingsRow />);

    expect(await screen.findByText(t("voiceInput.settings.device.denied"))).toBeInTheDocument();

    mic.setDevices([{ deviceId: "mic-1", label: "USB Microphone" }]);
    const before = mic.enumerateDevices.mock.calls.length;
    mic.setPermissionState("granted");

    await waitFor(() => expect(mic.enumerateDevices.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(screen.queryByText(t("voiceInput.settings.device.denied"))).toBeNull(),
    );
  });

  it("devicechange（插拔设备）触发重拉", async () => {
    const mic = installMic({
      devices: [{ deviceId: "mic-1", label: "USB Microphone" }],
      permission: "granted",
    });
    render(<MicSettingsRow />);

    await waitFor(() => expect(mic.enumerateDevices).toHaveBeenCalledTimes(1));
    const before = mic.enumerateDevices.mock.calls.length;
    mic.setDevices([{ deviceId: "mic-2", label: "Headset Microphone" }]);
    mic.emitDeviceChange();

    await waitFor(() => expect(mic.enumerateDevices.mock.calls.length).toBeGreaterThan(before));
  });

  it("测试麦克风弹层关闭后重查权限并重拉设备", async () => {
    const mic = installMic({ devices: [{ deviceId: "mic-1", label: "" }], permission: "granted" });
    render(<MicSettingsRow />);

    fireEvent.click(await screen.findByRole("button", { name: named(MIC_TEST_OPEN) }));
    const close = await waitFor(() => {
      const element = document.querySelector(".ant-modal-close");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    const before = mic.enumerateDevices.mock.calls.length;
    fireEvent.click(close);

    await waitFor(() => expect(mic.enumerateDevices.mock.calls.length).toBeGreaterThan(before));
  });
});
