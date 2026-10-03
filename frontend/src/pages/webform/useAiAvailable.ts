/**
 * 配没配模型决定 AI 开关能不能用。
 *
 * 判据与后端**逐字一致**（`base_url` 与 `model` 都非空，不看 api_key——本地部署的模型服务
 * 常常不需要）。不一致的话会出现"界面说能用、后端静默不用"或者反过来。
 */
import { useEffect, useState } from "react";
import { getLLMConfig } from "../../api/settings";

export function useAiAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void getLLMConfig()
      .then((config) => setAvailable(Boolean(config.base_url && config.model)))
      .catch(() => setAvailable(null));
  }, []);
  return available;
}
