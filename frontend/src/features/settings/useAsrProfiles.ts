// SPDX-License-Identifier: Apache-2.0
/** 语音转写「命名配置」的数据与动作：列表加载、使用（切换生效）、测试连接、删除、清 Key。
 *
 * 为什么单独一个 hook：设置卡拆成"编排层 + 列表 + 卡片 + 弹窗"之后，四个组件都要同一份
 * 状态与同一套错误提示。放组件里会让"删除后列表怎么变"散落在各层；放 hook 里只有一处。
 *
 * 测试结果**按配置 id 存**（不是单一 state）：一张卡的"连接成功"不能出现在另一张卡上。
 * 新建弹窗用 `NEW_ASR_PROFILE_ID` 作键（还没有 id）。
 */
import { App } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import {
  activateAsrProfile,
  clearAsrProfileKey,
  deleteAsrProfile,
  getAsrProfiles,
  saveAsrProfile,
  testAsrProfile,
  type AsrProfile,
  type AsrProfilePayload,
  type AsrProfileTestPayload,
  type AsrProfilesState,
  type AsrTestResult,
} from "../interview-voice/asrApi";

const EMPTY_STATE: AsrProfilesState = { active_profile_id: "", profiles: [] };

export interface AsrProfilesController {
  profiles: AsrProfile[];
  /** 生效中的那条（没有则为 null，徽标按"未配置"显示）。 */
  activeProfile: AsrProfile | null;
  loading: boolean;
  loadError: string;
  /** 正在执行「使用 / 删除 / 清除 Key」的配置 id（同一时刻只允许一个）。 */
  busyId: string | null;
  /** 正在测试连接的配置 id。 */
  testingId: string | null;
  /** 按配置 id 存的测试结论（互不覆盖）。 */
  testResults: Record<string, AsrTestResult>;
  reload: () => Promise<void>;
  activate: (profile: AsrProfile) => Promise<void>;
  remove: (profile: AsrProfile) => Promise<void>;
  clearKey: (profile: AsrProfile) => Promise<void>;
  /** 保存并返回新状态；失败时抛错，由弹窗就地显示（重名 409 等）。 */
  save: (payload: AsrProfilePayload) => Promise<AsrProfilesState>;
  test: (profileId: string, draft?: AsrProfileTestPayload) => Promise<AsrTestResult>;
  clearTestResult: (profileId: string) => void;
}

export function useAsrProfiles(): AsrProfilesController {
  const { message } = App.useApp();
  const [state, setState] = useState<AsrProfilesState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AsrTestResult>>({});

  /** 纯取数（不含 setState）：挂载 effect 与「重新读取」共用同一段。 */
  const fetchState = useCallback(async (): Promise<
    { state: AsrProfilesState } | { error: string }
  > => {
    try {
      return { state: await getAsrProfiles() };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : t("voiceInput.settings.loadFailed"),
      };
    }
  }, []);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchState();
      if (cancelled) return;
      if ("state" in result) {
        setState(result.state);
        setLoadError("");
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchState]);

  /** 「重新读取」：只翻 loading，不清空用户已经打开的状态。 */
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    const result = await fetchState();
    if ("state" in result) {
      setState(result.state);
      setLoadError("");
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  }, [fetchState]);

  /** 单条动作的统一壳：置忙 → 调用 → 用服务端返回的整份状态替换 → 提示。 */
  const runBusy = useCallback(
    async (
      profileId: string,
      action: () => Promise<AsrProfilesState>,
      successText: string,
    ): Promise<boolean> => {
      setBusyId(profileId);
      try {
        setState(await action());
        message.success(successText);
        return true;
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("voiceInput.settings.saveFailed"));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [message],
  );

  const activate = useCallback(
    async (profile: AsrProfile): Promise<void> => {
      await runBusy(
        profile.id,
        () => activateAsrProfile(profile.id),
        t("voiceInput.settings.profile.activated"),
      );
    },
    [runBusy],
  );

  const remove = useCallback(
    async (profile: AsrProfile): Promise<void> => {
      const ok = await runBusy(
        profile.id,
        () => deleteAsrProfile(profile.id),
        t("voiceInput.settings.profile.deleted"),
      );
      if (ok) {
        setTestResults((current) => {
          if (!(profile.id in current)) return current;
          const next = { ...current };
          delete next[profile.id];
          return next;
        });
      }
    },
    [runBusy],
  );

  const clearKey = useCallback(
    async (profile: AsrProfile): Promise<void> => {
      await runBusy(
        profile.id,
        () => clearAsrProfileKey(profile.id),
        t("voiceInput.settings.key.cleared"),
      );
    },
    [runBusy],
  );

  const save = useCallback(async (payload: AsrProfilePayload): Promise<AsrProfilesState> => {
    const next = await saveAsrProfile(payload);
    setState(next);
    return next;
  }, []);

  const test = useCallback(
    async (profileId: string, draft: AsrProfileTestPayload = {}): Promise<AsrTestResult> => {
      setTestingId(profileId);
      let result: AsrTestResult;
      try {
        result = await testAsrProfile(profileId, draft);
      } catch (error) {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : t("voiceInput.settings.testFailed"),
        };
      } finally {
        setTestingId(null);
      }
      setTestResults((current) => ({ ...current, [profileId]: result }));
      return result;
    },
    [],
  );

  const clearTestResult = useCallback((profileId: string): void => {
    setTestResults((current) => {
      if (!(profileId in current)) return current;
      const next = { ...current };
      delete next[profileId];
      return next;
    });
  }, []);

  const activeProfile = useMemo(
    () => state.profiles.find((profile) => profile.id === state.active_profile_id) ?? null,
    [state],
  );

  return {
    profiles: state.profiles,
    activeProfile,
    loading,
    loadError,
    busyId,
    testingId,
    testResults,
    reload,
    activate,
    remove,
    clearKey,
    save,
    test,
    clearTestResult,
  };
}
