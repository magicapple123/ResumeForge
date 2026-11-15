// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页就地改 Key / 清除 Key 的**唯一**派发处。
 *
 * 这里一条写语义都不新造：每一种来源都交回它自己的域端点（联网搜索的设置端点、
 * 全局模型配置、语音命名配置、会话密钥端点）。页面只负责"改完再读一次状态"。
 *
 * 为什么必须按来源分派而不能"统一写一个 key 字段"：五种存储形态的清除语义本来就不同
 * （`web_search` 空串=移除、语音/语义检索空串=沿用本条旧 Key、大模型用 `__clear__`
 * 哨兵、会话密钥是纯内存）。统一成一套必然改掉其中几处的既有行为（Q16）。
 */

import { clearLLMSessionKey, setLLMSessionKey } from "../../api/connections";
import { t } from "../../i18n";
import { getLLMConfig, getSearchConfig, saveLLMConfig, saveSearchConfig } from "../../api/settings";
import type { ConnectionItem, LLMConfig, SearchConfig } from "../../types";
import { clearAsrProfileKey, getAsrProfiles, saveAsrProfile } from "../interview-voice/asrApi";

/** 大模型端点显式清空 Key 的哨兵（与后端 `api/settings_llm_global` 的判据一致）。 */
const CLEAR_SENTINEL = "__clear__";

/** 三把联网搜索 Key 在 `SearchConfig` 里的字段名。 */
const SEARCH_KEY_FIELDS: Readonly<Record<string, keyof SearchConfig>> = {
  "web_search.deepseek": "deepseek_api_key",
  "web_search.tavily": "tavily_api_key",
  "web_search.jina": "jina_api_key",
};

const WEB_SEARCH_IDS = Object.keys(SEARCH_KEY_FIELDS);

/** 这条来源能不能在本页改（后端也会给 `editable`，这里只用来报"不支持"的错）。 */
export function supportsInlineWrite(itemId: string): boolean {
  return (
    WEB_SEARCH_IDS.includes(itemId) ||
    itemId === "llm.default" ||
    itemId === "llm.session" ||
    itemId === "asr.default"
  );
}

/** 联网搜索三把 Key：整份配置回写，只替换这一把（掩码与其它值原样带回）。 */
async function writeSearchKey(itemId: string, value: string): Promise<void> {
  const field = SEARCH_KEY_FIELDS[itemId];
  const config = await getSearchConfig();
  await saveSearchConfig({ ...config, [field]: value });
}

/** 大模型 Key：服务商与模型来自**当前生效配置**，空串=保留、哨兵=清除。 */
async function writeLLMKey(value: string): Promise<void> {
  const config = await getLLMConfig();
  // 只带 LLMConfig 认识的字段（掩码引用也照原样回传：后端按"端点未变才还原"处理）。
  const payload: LLMConfig = { ...config, api_key: value };
  await saveLLMConfig(payload);
}

/** 语音转写 Key：改的是**当前生效的那条命名配置**，其它条不受影响。 */
async function writeAsrKey(value: string): Promise<void> {
  const state = await getAsrProfiles();
  const active =
    state.profiles.find((profile) => profile.id === state.active_profile_id) ?? state.profiles[0];
  if (!active) {
    throw new Error(t("connections.error.noAsrProfile"));
  }
  await saveAsrProfile({
    id: active.id,
    name: active.name,
    preset_id: active.preset_id,
    base_url: active.base_url,
    model: active.model,
    protocol: active.protocol,
    api_key: value,
  });
}

async function clearAsrKey(): Promise<void> {
  const state = await getAsrProfiles();
  const active =
    state.profiles.find((profile) => profile.id === state.active_profile_id) ?? state.profiles[0];
  if (!active) return;
  await clearAsrProfileKey(active.id);
}

/** 写入一把新 Key。空串不是"清除"的统一写法：清除请走 {@link clearConnectionSecret}。 */
export async function writeConnectionSecret(item: ConnectionItem, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(t("connections.error.emptyValue"));
  }
  if (item.id in SEARCH_KEY_FIELDS) {
    await writeSearchKey(item.id, trimmed);
    return;
  }
  if (item.id === "llm.default") {
    await writeLLMKey(trimmed);
    return;
  }
  if (item.id === "llm.session") {
    await setLLMSessionKey(trimmed);
    return;
  }
  if (item.id === "asr.default") {
    await writeAsrKey(trimmed);
    return;
  }
  throw new Error(t("connections.error.unsupported"));
}

/** 真正清除（不是写空串绕过）：每种来源各走自己的清除语义。 */
export async function clearConnectionSecret(item: ConnectionItem): Promise<void> {
  if (item.id in SEARCH_KEY_FIELDS) {
    // 联网搜索的既有语义就是"空串 = 用户显式移除这把 Key"。
    await writeSearchKey(item.id, "");
    return;
  }
  if (item.id === "llm.default") {
    await writeLLMKey(CLEAR_SENTINEL);
    return;
  }
  if (item.id === "llm.session") {
    await clearLLMSessionKey();
    return;
  }
  if (item.id === "asr.default") {
    await clearAsrKey();
    return;
  }
  throw new Error(t("connections.error.unsupported"));
}
