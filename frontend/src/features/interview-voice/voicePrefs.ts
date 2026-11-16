// SPDX-License-Identifier: Apache-2.0
/**
 * 麦克风偏好：选中的设备 id、设备列表，以及**浏览器麦克风权限**的查询与申请。
 *
 * 只存"界面偏好"（哪个输入设备），**不是用户数据**，所以落 `localStorage`：切换数据集
 * 不该重置它（同 #7 的偏好口径）。读写一律包 `try/catch`——隐私模式、被策略禁用的
 * 存储、以及 Firefox 的 `SecurityError` 都会在**读**的时候就抛，那时录音本身仍然可用，
 * 不能因为存不下偏好就录不了音。
 *
 * `deviceId` 的不稳定性写在 #8 风险一节：它按 origin 作用域生成，清缓存/换端口/换
 * 浏览器都会变。失效时的处理是"回退系统默认 + 清存储 + 提示一次"，不做设备别名。
 *
 * ## 为什么要在这里放权限逻辑（I-07）
 *
 * 授权是**异步且带副作用**的动作：申请一次会点亮系统麦克风指示灯。这类"取流 + 立刻
 * 释放 + 错误归类"的实现散在 UI 里，下一次有人加一个入口就会漏掉 stop。所以集中成
 * `ensureMicPermission()` 一个出口，错误分类复用 `hooks/voiceErrors.ts`（与录音、
 * 测试麦克风同一个 `NotAllowedError` → 同一句文案）。
 *
 * ## 三态而不是布尔
 *
 * `prompt`（还没做过选择）与 `denied`（用户或策略明确拒绝）必须分开：前者给"授权
 * 麦克风"按钮就能解决，后者要先让用户去站点设置里解除，两者混成一个 `false` 就只能
 * 说"不可用"，用户无从下手。
 */

import { errorOf, microphoneErrorFor, type VoiceError } from "../../hooks/voiceErrors";

const DEVICE_STORAGE_KEY = "resumeforge.voice.device_id";

export interface AudioInputDevice {
  /** 浏览器给的空串表示"系统默认"，与 `getUserMedia({audio:true})` 等价。 */
  deviceId: string;
  /** 未授权/未授权前为空串（浏览器隐私规定，不是 bug）。 */
  label: string;
}

/** 麦克风权限三态：`prompt` = 尚未选择或无法判定，`denied` = 明确被拒。 */
export type MicPermissionState = "granted" | "prompt" | "denied";

/**
 * `{ name: "microphone" }` 的描述符。
 *
 * 为什么用 `as unknown as`：`PermissionDescriptor.name` 的类型是 `PermissionName`
 * 联合体，而 `"microphone"` 在不同 TS 版本的 DOM lib 里时有时无；直接写成
 * `{ name: "microphone" }` 会让 `tsc` 在缺少该成员的版本上直接报错。
 */
const MICROPHONE_DESCRIPTOR = { name: "microphone" } as unknown as PermissionDescriptor;

/** 读上次选的设备 id；没存过或读不出来都返回 `null`（= 系统默认）。 */
export function readPreferredDeviceId(): string | null {
  try {
    const stored = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** 存选中的设备；传 `null` 表示清掉（回退系统默认）。 */
export function savePreferredDeviceId(deviceId: string | null): void {
  try {
    if (deviceId && deviceId.length > 0) {
      window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
      return;
    }
    window.localStorage.removeItem(DEVICE_STORAGE_KEY);
  } catch {
    // 存不下不是错误：这一次录音仍按所选设备进行，只是下次要重选。
  }
}

/**
 * 列出可选输入设备。
 *
 * **必须先拿到权限**，否则 `label` 全是空串（浏览器隐私规定）。所以首次进入设置页时
 * 列表可能是空的、或者只有一串无名设备——这不是缺陷，UI 上用「麦克风 1」这类占位名
 * 兜住，并提示"授权后可见设备名"。
 */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.enumerateDevices) return [];
  try {
    const devices = await media.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    return [];
  }
}

/** `PermissionStatus.state` 的三值里，只有它们能直接当 `MicPermissionState` 用。 */
function toPermissionState(value: string | undefined): MicPermissionState | null {
  if (value === "granted" || value === "denied" || value === "prompt") return value;
  return null;
}

/**
 * 权限 API 不可用时的**回退判定**：按设备名判空。
 *
 * 能读到设备名说明浏览器已经授权过（隐私规定：未授权时 `label` 必为空串）；读不到
 * 只能判断"还没授权"，**推断不出 denied**——所以回退只可能给出 `granted` / `prompt`。
 */
async function derivePermissionFromDevices(): Promise<MicPermissionState> {
  const devices = await listAudioInputs();
  return devices.some((device) => device.label.trim().length > 0) ? "granted" : "prompt";
}

/**
 * 查询当前麦克风权限。
 *
 * `navigator.permissions.query({name:"microphone"})` 是 Chromium 的扩展，Safari 与部分
 * 版本会**抛 `TypeError`**（不是返回 rejected promise，有些实现是同步抛）。所以整段包
 * `try/catch` 并回退按设备名判空，**绝不让"查不到"变成"页面崩"**。
 */
export async function queryMicPermission(): Promise<MicPermissionState> {
  const permissions = typeof navigator === "undefined" ? undefined : navigator.permissions;
  if (permissions?.query) {
    try {
      const status = await permissions.query(MICROPHONE_DESCRIPTOR);
      const state = toPermissionState(status?.state);
      if (state) return state;
    } catch {
      // 见上：不支持该名字就退回设备名判空。
    }
  }
  return derivePermissionFromDevices();
}

/**
 * 订阅权限变化（用户在站点设置里改了开关、或别的标签页授权了）。
 *
 * 为什么要订阅：`devicechange` **不覆盖"权限被授予"**这件事——授权后不触发设备插拔，
 * 于是下拉里仍旧是一串无名设备，用户必须手动点那个只有图标的刷新按钮（I-07 的现状）。
 *
 * 返回退订函数；不支持权限 API 时返回一个空函数（调用方不必判空）。
 */
export function watchMicPermission(onChange: (state: MicPermissionState) => void): () => void {
  const permissions = typeof navigator === "undefined" ? undefined : navigator.permissions;
  if (!permissions?.query) return () => undefined;

  let disposed = false;
  let status: PermissionStatus | null = null;

  const emit = () => {
    if (disposed || !status) return;
    const state = toPermissionState(status.state);
    if (state) onChange(state);
  };

  void (async () => {
    try {
      const next = await permissions.query(MICROPHONE_DESCRIPTOR);
      if (disposed) return;
      status = next;
      // 老实现只有 `onchange` 没有事件监听；两种都挂上，重复触发由 `emit` 幂等吸收。
      if (typeof next?.addEventListener === "function") {
        next.addEventListener("change", emit);
      } else {
        next.onchange = emit;
      }
      // 查询本身可能已经不是初始态（例如另一个标签页刚授权完）。
      emit();
    } catch {
      // 不支持就只靠 `devicechange` 刷新列表，UI 不会因此不可用。
    }
  })();

  return () => {
    disposed = true;
    if (!status) return;
    if (typeof status.removeEventListener === "function") {
      status.removeEventListener("change", emit);
    } else {
      status.onchange = null;
    }
  };
}

/** `ensureMicPermission()` 的结果：结论 + 失败原因（成功时为 `null`）。 */
export interface MicPermissionOutcome {
  state: MicPermissionState;
  error: VoiceError | null;
}

/**
 * 申请麦克风权限：**唯一**的授权入口（浏览器要求由用户手势触发，不能后台自动弹）。
 *
 * 三个步骤写死在一起，缺一个就会留下可见缺陷：
 * 1. `getUserMedia({audio:true})` —— 只有取流才会真正弹授权框；
 * 2. **立刻 stop 全部 track** —— 授权按钮不是录音入口，指示灯必须马上熄灭；
 * 3. 错误归类 —— 复用 `microphoneErrorFor`，与录音/测试麦克风同一句文案。
 *
 * 失败时 `state` 的判定：`permission_denied` 才是 `denied`（需要去站点设置解除）；
 * "没有设备""采集失败"都只是"这次没成功"，仍可重试，所以留在 `prompt`。
 */
export async function ensureMicPermission(): Promise<MicPermissionOutcome> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.getUserMedia) {
    return { state: "denied", error: errorOf("unsupported") };
  }
  let stream: MediaStream | null = null;
  try {
    stream = await media.getUserMedia({ audio: true });
    return { state: "granted", error: null };
  } catch (microphoneError) {
    const voiceError = microphoneErrorFor(microphoneError);
    return {
      state: voiceError.code === "permission_denied" ? "denied" : "prompt",
      error: voiceError,
    };
  } finally {
    // finally 而不是成功分支里 stop：异常路径上若实现已经拿到了流，同样要灭灯。
    stream?.getTracks().forEach((track) => track.stop());
  }
}
