// SPDX-License-Identifier: Apache-2.0
/**
 * 麦克风偏好：选中的设备 id 与设备列表。
 *
 * 只存"界面偏好"（哪个输入设备），**不是用户数据**，所以落 `localStorage`：切换数据集
 * 不该重置它（同 #7 的偏好口径）。读写一律包 `try/catch`——隐私模式、被策略禁用的
 * 存储、以及 Firefox 的 `SecurityError` 都会在**读**的时候就抛，那时录音本身仍然可用，
 * 不能因为存不下偏好就录不了音。
 *
 * `deviceId` 的不稳定性写在 #8 风险一节：它按 origin 作用域生成，清缓存/换端口/换
 * 浏览器都会变。失效时的处理是"回退系统默认 + 清存储 + 提示一次"，不做设备别名。
 */

const DEVICE_STORAGE_KEY = "resumeforge.voice.device_id";

export interface AudioInputDevice {
  /** 浏览器给的空串表示"系统默认"，与 `getUserMedia({audio:true})` 等价。 */
  deviceId: string;
  /** 未授权/未授权前为空串（浏览器隐私规定，不是 bug）。 */
  label: string;
}

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
