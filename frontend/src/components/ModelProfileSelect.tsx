/**
 * 页头全局模型选择器（R21）：显示当前 profile 与模型，切换即 activate。
 *
 * 只在**配了全局 profile** 时渲染：只配了数据集级模型的用户看到空下拉会误以为
 * "模型没生效"，所以干脆不出现。
 */
import { App, Select } from "antd";
import { useEffect, useState } from "react";
import { activateGlobalLLMProfile, getGlobalLLM, type GlobalLLMSummary } from "../api/settings";

export default function ModelProfileSelect() {
  const { message } = App.useApp();
  const [summary, setSummary] = useState<GlobalLLMSummary | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGlobalLLM()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // 读不到（老后端 / 文件损坏）就不显示，不打扰页头。
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary || summary.profiles.length === 0) return null;

  const activeId = summary.active_profile_id || summary.profiles[0]?.id;

  const switchProfile = async (id: string) => {
    setSwitching(true);
    try {
      setSummary(await activateGlobalLLMProfile(id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换模型配置失败");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Select
      // 必需：rc-util 在测试环境把所有 useId 都返回 "test-id"，页头 Modal 的
      // aria-labelledby 会指到这个 input，导致按"角色 + 名称"查询对话框全部失效。
      id="global-model-profile-select"
      className="app-model-profile-select"
      aria-label="当前全局模型"
      value={activeId}
      loading={switching}
      popupMatchSelectWidth={false}
      onChange={(id: string) => void switchProfile(id)}
      options={summary.profiles.map((profile) => ({
        value: profile.id,
        label: profile.model ? `${profile.name} · ${profile.model}` : profile.name,
      }))}
    />
  );
}
