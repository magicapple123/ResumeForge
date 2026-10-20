// SPDX-License-Identifier: Apache-2.0
/**
 * 页头模型切换下拉（C-3 / T8）：放在数据集下拉**左侧**，显示当前「使用中」的记录。
 *
 * 与设置页读写同一份数据（`/api/settings/llm/records` + activate），因此这里切换
 * 等于全局切换，所有数据集立刻生效。四条刻意的做法：
 *
 * 1. **只在有记录时渲染**：一条记录都没有的用户看到空下拉只会以为"模型坏了"，
 *    干脆不出现；配置记录在设置 → AI 模型里创建。
 * 2. **每次路由变化重新拉取**：页头在路由切换时不会重新挂载，用户在设置页切了模型
 *    回到岗位页，如果只加载一次就会显示旧名字。
 * 3. **失败静默**：读不到（老后端、文件损坏）就不显示，不打扰其它功能。
 * 4. **双击只测连接、绝不切换**（T8）：切错模型会让接下来所有生成都用错供应商，
 *    而"这条配置还能用吗"是个很自然的疑问。所以单击延后 220ms 再生效，这段时间内
 *    第二次按下（`MouseEvent.detail >= 2`）就把切换取消、改成跑一次连通性测试。
 */
import { LoadingOutlined } from "@ant-design/icons";
import { App, Select } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { subscribeLLMConfig } from "../features/settings/llmConfigEvents";
import { getLLMConfig, listLLMConfigRecords, activateLLMRecord, testLLM } from "../api/settings";
import { configFromRecord } from "./settings/SettingsConfig";
import type { LLMConfigRecord } from "../types";

/**
 * 单击到真正切换之间的等待（毫秒）。
 *
 * 双击的第二下必须在它到期前落下（系统默认双击阈值约 200–250ms）。定得太短会让双击
 * 来不及取消切换，太长则单击切换明显发木。
 */
const SWITCH_DELAY_MS = 220;

export default function ModelProfileSelect() {
  const { message } = App.useApp();
  const location = useLocation();
  const [records, setRecords] = useState<LLMConfigRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);
  /** 正在测连接的那条记录 id（同一时间只允许一个）。 */
  const [testingId, setTestingId] = useState<string | null>(null);
  /** 待生效的切换：双击要能取消它，所以计时器得留在 ref 里。 */
  const pendingSwitch = useRef<{ id: string; timer: number } | null>(null);
  /** 双击已经被识别过：紧随其后的那次 `onSelect` 不能再排一次切换。 */
  const suppressNextSelect = useRef(false);

  /** 取一次记录与生效项；返回取消函数（响应回来时组件可能已经不在）。 */
  const loadRecords = useCallback(() => {
    // 取数放在 effect 内联：Compiler 要求"同步 setState"与取数分开，这里的状态
    // 更新全在 then 回调里；cancelled 防止快速切路由时旧响应覆盖新数据。
    let cancelled = false;
    Promise.all([getLLMConfig(), listLLMConfigRecords()])
      .then(([config, list]) => {
        if (cancelled) return;
        setRecords(list);
        setActiveId(config.record_id ?? null);
      })
      .catch(() => {
        // 读不到就不显示（见文件头第 3 条）。
        if (cancelled) return;
        setRecords([]);
        setActiveId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadRecords(), [loadRecords, location.pathname]);

  // 设置里保存/启用/删除配置后立刻重取（本轮新增）。在此之前只有路由变化会刷新，
  // 于是"设置里换了模型、顶上还显示旧的"——页头与设置页是两棵互不相识的子树。
  useEffect(() => subscribeLLMConfig(loadRecords), [loadRecords]);

  const clearPendingSwitch = () => {
    const pending = pendingSwitch.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingSwitch.current = null;
  };

  // 卸载 / 收起下拉时取消待生效的切换：否则面板关掉 220ms 后模型还是被换掉了。
  useEffect(() => {
    if (open) return undefined;
    clearPendingSwitch();
    return undefined;
  }, [open]);

  // 卸载时也清一次（hooks 必须在 `return null` 之前，否则没有记录时 hooks 顺序会变）。
  useEffect(() => () => clearPendingSwitch(), []);

  if (records.length === 0) return null;

  const switchRecord = async (id: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      const activated = await activateLLMRecord(id);
      setActiveId(activated.id);
      message.success(`已切换到配置「${activated.name}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "切换模型配置失败");
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  };

  /** 单击：延后 220ms 再切，给双击留出取消的机会。 */
  const scheduleSwitch = (id: string) => {
    clearPendingSwitch();
    const timer = window.setTimeout(() => {
      pendingSwitch.current = null;
      void switchRecord(id);
    }, SWITCH_DELAY_MS);
    pendingSwitch.current = { id, timer };
  };

  /** 双击：只测连接，绝不切换当前配置。 */
  const testRecord = async (id: string) => {
    if (testingId !== null) return;
    const record = records.find((item) => item.id === id);
    if (!record) return;
    setTestingId(id);
    try {
      // 耗时只用后端回的 `latency_ms`：本地 `Date.now()` 计时没有意义（网络往返之外
      // 还含渲染开销，和后端测的不是一回事），而且组件体里的函数被编译器判成渲染期
      // 调用会被 `react-hooks/purity` 拦下。后端没给就只说"正常"。
      const result = await testLLM(configFromRecord(record));
      if (!result.ok) {
        message.error(`「${record.name}」连接失败：${result.message || "未知原因"}`);
      } else if (result.latency_ms != null) {
        message.success(`「${record.name}」连接正常（${result.latency_ms}ms）`);
      } else {
        message.success(`「${record.name}」连接正常`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知原因";
      message.error(`「${record.name}」连接失败：${detail}`);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <Select
      // 必需：rc-util 在测试环境把所有 useId 都返回 "test-id"，页头弹窗的
      // aria-labelledby 会指到这个 input，导致按"角色 + 名称"查询对话框全部失效。
      id="global-model-profile-select"
      className="app-model-profile-select"
      aria-label="当前模型配置"
      value={activeId ?? undefined}
      placeholder="选择模型配置"
      loading={switching}
      // 触发器固定 200px（见 base.css 的 .app-model-profile-select），弹层**不跟着它**
      // 变窄：`false` 让弹层按内容自适应，再由下面的 maxWidth 收到 320px。
      // 分工是"触发框只交代当前是谁，弹层要能扫视比较"（D2）。
      popupMatchSelectWidth={false}
      // antd 6 的语义化样式入口：`popup.root` 即 `.ant-select-dropdown` 根节点。
      styles={{ popup: { root: { maxWidth: 320 } } }}
      // 受控展开：单击选中后不能立刻收起，否则双击的第二下没地方落。
      open={open}
      onOpenChange={(next) => {
        // 选中一项时 rc-select 会顺手请求"收起"：这时**不能**真收，否则点击排下的
        // 220ms 切换会被"关闭即清队列"的规则当场取消（单击就永远不生效了）。
        if (!next && pendingSwitch.current) return;
        setOpen(next);
        if (!next) suppressNextSelect.current = false;
      }}
      onSelect={(id: string) => {
        if (suppressNextSelect.current) {
          suppressNextSelect.current = false;
          return;
        }
        scheduleSwitch(id);
      }}
      options={records.map((record) => ({
        value: record.id,
        label: record.model ? `${record.name} · ${record.model}` : record.name,
      }))}
      optionRender={(option) => {
        const id = String(option.value);
        return (
          <div
            className="model-option"
            onMouseDown={(event) => {
              if (event.detail < 2) {
                // 新一次交互：清掉"上一轮双击"的抑制标记。
                suppressNextSelect.current = false;
                return;
              }
              // 双击：不让它变成"选中 + 收起"，取消待生效的切换，改跑连通性测试。
              event.preventDefault();
              event.stopPropagation();
              suppressNextSelect.current = true;
              clearPendingSwitch();
              setOpen(true);
              void testRecord(id);
            }}
          >
            {/* 省略号之外的兜底：`title` 让长记录名在 hover 时能看全（弹层上限 320px，
                超出部分由 CSS 截断）。`label` 在 antd 的类型里是 ReactNode，只有字符串
                才适合当原生 title，所以先判类型。 */}
            <span
              className="model-option-label"
              title={typeof option.label === "string" ? option.label : undefined}
            >
              {option.label}
            </span>
            {testingId === id && <LoadingOutlined className="model-option-testing" />}
          </div>
        );
      }}
    />
  );
}
