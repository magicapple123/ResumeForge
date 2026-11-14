// SPDX-License-Identifier: Apache-2.0
/**
 * 面试镜头（F18）的前端配置：总开关、本地录像、抽帧分析、录像保留、是否计入总分。
 *
 * 为什么存 `localStorage` 而不是数据库：这些是"这台机器上我要不要被录"的界面偏好，
 * 与当前打开哪份数据集无关（与 `voiceSettings` 同一条判据）。**但录像本身落在数据目录**
 * ——配置可以跟着浏览器走，文件必须跟着数据走，否则换浏览器就找不到自己录的东西。
 *
 * 默认全关：面部画面属敏感个人信息，"默认开、无声上传"是红线。首次打开总开关时由
 * 设置卡弹一次说明（`consentSeen`），不是每场面试都弹。
 */
import { useEffect, useState } from "react";

/** 只有这三档：7 天（默认）/ 30 天 / 不自动删。 */
export type CameraRetentionDays = 0 | 7 | 30;

export interface InterviewCameraSettings {
  version: 1;
  /** 总开关：关着时房间不申请摄像头、不录制、不抽帧。 */
  enabled: boolean;
  /** 本地录像（只录画面、不录声音）。总开关打开后默认开。 */
  record: boolean;
  /** 抽帧分析（送模型判断镜头表现）。总开关打开后默认开。 */
  analyze: boolean;
  /** 录像保留天数；0 = 不自动删。 */
  retentionDays: CameraRetentionDays;
  /**
   * 是否把镜头分并入面试总分。**默认关**——镜头分是实验性的，不该悄悄改变用户
   * 已经熟悉的四维总分。并入权重固定 15%，与后端 `CAMERA_SCORE_IN_TOTAL_WEIGHT` 一致。
   */
  countInScore: boolean;
  /** 首次开启总开关时的说明是否已确认（只弹一次）。 */
  consentSeen: boolean;
}

export const CAMERA_SETTINGS_KEY = "resumeforge.interviewCamera.settings.v1";

export const DEFAULT_CAMERA_SETTINGS: InterviewCameraSettings = {
  version: 1,
  enabled: false,
  record: true,
  analyze: true,
  retentionDays: 7,
  countInScore: false,
  consentSeen: false,
};

/** 抽帧参数：与后端 `CAMERA_MAX_FRAMES` 对齐（12 帧），间隔 15 秒。 */
export const CAMERA_FRAME_INTERVAL_MS = 15_000;
export const CAMERA_MAX_FRAMES = 12;
/** 录像上限：30 分钟 / 200MB，与后端一致；超限自动停并在报告里注明。 */
export const CAMERA_MAX_RECORD_SECONDS = 30 * 60;
export const CAMERA_MAX_RECORD_BYTES = 200 * 1024 * 1024;

function toRetentionDays(value: unknown): CameraRetentionDays {
  return value === 0 || value === 30 || value === 7 ? value : DEFAULT_CAMERA_SETTINGS.retentionDays;
}

/** 把任意来源的值收成合法设置：缺字段补默认、布尔值只认真正的 boolean。 */
export function normalizeCameraSettings(raw: unknown): InterviewCameraSettings {
  const source = (raw ?? {}) as Partial<InterviewCameraSettings>;
  const base = DEFAULT_CAMERA_SETTINGS;
  return {
    version: 1,
    enabled: source.enabled === true,
    record: typeof source.record === "boolean" ? source.record : base.record,
    analyze: typeof source.analyze === "boolean" ? source.analyze : base.analyze,
    retentionDays: toRetentionDays(source.retentionDays),
    countInScore: source.countInScore === true,
    consentSeen: source.consentSeen === true,
  };
}

export function loadCameraSettings(): InterviewCameraSettings {
  if (typeof window === "undefined") return DEFAULT_CAMERA_SETTINGS;
  try {
    const text = window.localStorage.getItem(CAMERA_SETTINGS_KEY);
    if (!text) return DEFAULT_CAMERA_SETTINGS;
    return normalizeCameraSettings(JSON.parse(text));
  } catch {
    return DEFAULT_CAMERA_SETTINGS;
  }
}

const EVENT = "resumeforge:interview-camera-settings";

export function saveCameraSettings(next: InterviewCameraSettings): InterviewCameraSettings {
  const normalized = normalizeCameraSettings(next);
  try {
    window.localStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // 隐私模式 / 配额满：本次页面内仍然生效，只是重启不保留。不该因此打断面试。
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
  return normalized;
}

export function patchCameraSettings(
  patch: Partial<InterviewCameraSettings>,
): InterviewCameraSettings {
  return saveCameraSettings({ ...loadCameraSettings(), ...patch });
}

/** 订阅式读取：设置卡与房间里的开关改同一份值，任一处保存后另一处立即重渲染。 */
export function useCameraSettings(): [InterviewCameraSettings, typeof patchCameraSettings] {
  const [settings, setSettings] = useState<InterviewCameraSettings>(loadCameraSettings);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<InterviewCameraSettings>).detail;
      setSettings(detail ? normalizeCameraSettings(detail) : loadCameraSettings());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CAMERA_SETTINGS_KEY) setSettings(loadCameraSettings());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [settings, patchCameraSettings];
}
