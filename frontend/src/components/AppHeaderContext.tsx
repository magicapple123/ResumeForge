// SPDX-License-Identifier: Apache-2.0
/**
 * 页头右侧的「当前数据集 + 用户头像」。
 *
 * 三件事放在一起，因为它们回答的是同一个问题：**我现在是在什么上下文里操作**。
 * - 数据集：简历通支持多套互相独立的数据集（工作一份、私人一份），而界面其余部分长得
 *   一模一样，切错数据集会产生"我的简历怎么不见了"这类误会。
 * - 我的空间（`beforeAvatar` 插槽）：与头像同属"我是谁 / 我有哪些私有空间"这一组，
 *   排在头像左侧；它由调用方注入，因为入口列表来自导航配置，不该由页头自己决定。
 * - 头像：用「我的资料」里**当前启用的那张照片**，一眼就能认出这是谁的那份数据。
 *
 * 两个刻意的做法：
 * 1. 数据集在这里可以直接切换，但切换成功后会整页重载，保证岗位、资料和缓存都来自新数据集。
 * 2. **头像不出本机**。照片存在本地数据库里，这里只是把它显示出来，不发给任何模型。
 *
 * 为什么用插槽而不是 CSS `order`：视觉顺序要的是 `[数据集][我的空间][头像]`，而
 * `.app-header-context` 是个独立的 flex 容器——`order` 只在同级之间生效，跨容器排不了。
 * 插槽把顺序写进 DOM，既显式又能被测试钉住。
 */
import {
  DatabaseOutlined,
  DownOutlined,
  HomeOutlined,
  PlusOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { App, Avatar, Dropdown, Skeleton, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getProfile } from "../api/profile";
import { registerDatasetMenuHandler } from "../features/shortcuts/runtimeTargets";
import { activateDataset, createDataset, listDatasets } from "../api/settings";
import type { Profile } from "../types";
import type { DatasetInfo } from "../types/settings";
import { reloadPage } from "../utils/navigation";
import { saveActiveDatasetId } from "../utils/datasetScope";
import DatasetCreateModal from "./DatasetCreateModal";

/** 下拉菜单里「新建数据集…」的 key：与数据集 id 不可能冲突。 */
const CREATE_DATASET_KEY = "create-dataset";

interface Props {
  /**
   * 渲染在**头像左侧**的插槽（项 1）：目前是「我的空间」入口。
   *
   * 只接受"已经就绪"的节点：它和头像同时出现（都在 `ready` 之后），避免页头先闪出一个
   * 空位再补内容。
   */
  beforeAvatar?: ReactNode;
}

export default function AppHeaderContext({ beforeAvatar }: Props = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { message, modal } = App.useApp();
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [, setDatasetCount] = useState(0); // 计数原先只用于悬停提示，提示移除后仅保留写入
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // 数据集下拉的受控开关：快捷键要能把它打开（见 R8 的 switchDataset）。
  const [datasetMenuOpen, setDatasetMenuOpen] = useState(false);
  /** 弹层宽度：打开时按触发框实测，保证两者同宽（见 onOpenChange）。 */
  const [datasetMenuWidth, setDatasetMenuWidth] = useState<number | undefined>(undefined);
  const datasetChipRef = useRef<HTMLButtonElement | null>(null);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  // R8：把「打开数据集下拉」登记给快捷键系统。下拉的开关只有本组件知道，
  // 让 App 直接 import 这里的状态会把页头变成一个全局单例，登记-注销更干净。
  useEffect(() => {
    registerDatasetMenuHandler(() => setDatasetMenuOpen(true));
    return () => registerDatasetMenuHandler(null);
  }, []);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（页头是全局装饰：读不到就少显示一块，绝不报错或白屏）。
  const fetchHeaderData = useCallback(async () => {
    try {
      const [datasets, current] = await Promise.all([listDatasets(), getProfile()]);
      return { datasets, current };
    } catch {
      return null;
    }
  }, []);

  // Compiler 规范：应用状态放在 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    void fetchHeaderData().then((result) => {
      if (cancelled) return;
      if (result) {
        setDatasets(result.datasets);
        const active = result.datasets.find((item) => item.is_active) ?? result.datasets[0] ?? null;
        setDataset(active);
        // 把 active id 落到 localStorage（RF-13）：网申草稿等首帧同步读取方
        // 等不了接口，只能从这里取上一次会话写下的值。
        saveActiveDatasetId(active?.id);
        setDatasetCount(result.datasets.length);
        setProfile(result.current);
      } else {
        setDataset(null);
        setProfile(null);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHeaderData, location.pathname]);

  const handleDatasetSwitch = useCallback(
    async (id: string) => {
      if (!id || id === dataset?.id || switchingId !== null) return;
      const next = datasets.find((item) => item.id === id);
      if (!next) return;
      setSwitchingId(id);
      setSwitchError("");
      try {
        await activateDataset(id);
        // 先更新页头，用户能立即知道操作已生效；整页重载负责清理各页面的数据缓存。
        // active id 必须在 reload 前落盘：重载后的首帧（如网申草稿恢复）只能读到它。
        setDataset(next);
        saveActiveDatasetId(next.id);
        window.setTimeout(reloadPage, 250);
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : "切换数据集失败");
        setSwitchingId(null);
      }
    },
    [dataset?.id, datasets, switchingId],
  );

  // 「示例」徽标 + 一键回到主数据：示例数据集（source === "sample"）与用户的真实
  // 资料相互独立，界面上必须随时说清"现在看的是示例"，并给出回主数据的醒目出路。
  const isSampleActive = dataset?.source === "sample";

  /**
   * 新建数据集：成功后问一句"要不要马上切过去"。
   *
   * 不自动切换是刻意的——用户可能只是想先把一份新数据集准备好（例如面试练习），
   * 立刻切走会让人误以为刚才的数据丢了。切换仍复用 activateDataset + 整页重载。
   */
  const handleCreateDataset = useCallback(async () => {
    if (creating) return;
    const name = createName.trim();
    if (!name) {
      message.warning("请填写数据集名称");
      return;
    }
    setCreating(true);
    try {
      const created = await createDataset(name);
      setCreateOpen(false);
      setCreateName("");
      // 列表单独刷新：这一步失败不影响"已经建好"这个事实，下次进页面还会再拉一次。
      try {
        setDatasets(await listDatasets());
      } catch {
        /* 忽略：下拉条目下一次挂载时会自然补齐 */
      }
      modal.confirm({
        title: `已新建「${created.name || name}」`,
        content: "是否立即切换到这个数据集？",
        okText: "立即切换",
        cancelText: "稍后",
        onOk: async () => {
          try {
            await activateDataset(created.id);
            // active id 必须在 reload 前落盘（与下拉切换同一套收尾）：重载后的首帧
            // 只有 localStorage 可读。
            saveActiveDatasetId(created.id);
            window.setTimeout(reloadPage, 250);
          } catch (error) {
            message.error(error instanceof Error ? error.message : "切换数据集失败");
          }
        },
      });
    } catch (error) {
      // 后端的 detail 原文（例如「数据集名称已存在」）比通用文案有用得多。
      message.error(error instanceof Error ? error.message : "新建数据集失败");
    } finally {
      setCreating(false);
    }
  }, [createName, creating, message, modal]);

  const datasetMenuItems = useMemo<MenuProps["items"]>(() => {
    const items: MenuProps["items"] = datasets.map((item) => ({
      key: item.id,
      label: (
        <span className="app-dataset-menu-label" title={item.name}>
          {item.is_active ? `${item.name}（当前）` : item.name}
          {item.source === "sample" && (
            <Tooltip title="体验数据，与你的真实资料相互独立">
              <span className="app-dataset-sample-tag">示例</span>
            </Tooltip>
          )}
        </span>
      ),
      disabled: item.is_active || switchingId !== null,
    }));
    // 处在示例数据集里时，给第一个非示例数据集（通常是主数据）一条醒目的返回动作；
    // 仍走既有 activateDataset 流程，只是多一个入口。
    const mainDataset = datasets.find((item) => item.source !== "sample");
    if (isSampleActive && mainDataset && !mainDataset.is_active) {
      items.unshift({
        key: `return-main:${mainDataset.id}`,
        icon: <HomeOutlined />,
        label: <span className="app-dataset-return">回到我的数据</span>,
      });
    }
    // 末尾固定留一个「新建数据集…」：用户想到"再开一份数据"的时刻正是在这个下拉里，
    // 让他先跳去设置页再回来是最容易放弃的路径。
    items.push({ type: "divider" });
    items.push({
      key: CREATE_DATASET_KEY,
      icon: <PlusOutlined />,
      label: "新建数据集…",
    });
    return items;
  }, [datasets, switchingId, isSampleActive]);

  const displayName = (profile?.name || "").trim();
  const photo = (profile?.photo || "").trim();
  const initial = displayName ? Array.from(displayName)[0] : "";

  return (
    <div className="app-header-context">
      {!ready ? (
        <Skeleton.Avatar active size={36} shape="circle" />
      ) : (
        <>
          {dataset ? (
            <Dropdown
              trigger={["click"]}
              // R8：受控开关，供「切换数据集」快捷键打开（Ctrl/⌘+Shift+D）。
              open={datasetMenuOpen}
              onOpenChange={(next) => {
                setDatasetMenuOpen(next);
                // 弹层宽度跟随触发框（用户反馈：弹层比圆角框宽出一截）。
                // 打开时量一次即可——chip 的宽度在同一屏里不会变，关着的时候量不到。
                if (next) setDatasetMenuWidth(datasetChipRef.current?.offsetWidth);
              }}
              styles={{
                root:
                  datasetMenuWidth && datasetMenuWidth > 0
                    ? { width: datasetMenuWidth, maxWidth: datasetMenuWidth }
                    : undefined,
              }}
              // 数据集名可以很长（导入的名称不受限），弹层不设上限时会被一个名字撑到
              // 半屏宽。宽度约束与省略号都放在 CSS 里（.app-dataset-dropdown），
              // 完整名字通过条目的 title 属性悬停可见。
              classNames={{ root: "app-dataset-dropdown" }}
              menu={{
                items: datasetMenuItems,
                onClick: ({ key }) => {
                  // 「新建数据集…」是动作入口，不是数据集 id：只开弹窗，不触发切换。
                  if (key === CREATE_DATASET_KEY) {
                    setCreateName("");
                    setCreateOpen(true);
                    return;
                  }
                  // 「回到我的数据」是动作入口：解析出目标数据集 id，仍走切换流程。
                  const targetId = key.startsWith("return-main:")
                    ? key.slice("return-main:".length)
                    : key;
                  void handleDatasetSwitch(targetId);
                },
              }}
            >
              <button
                ref={datasetChipRef}
                type="button"
                className="app-dataset-chip"
                aria-label={`当前数据集：${dataset.name}`}
                aria-haspopup="menu"
              >
                <DatabaseOutlined />
                <span className="app-dataset-name">{dataset.name}</span>
                {isSampleActive && (
                  <Tooltip title="体验数据，与你的真实资料相互独立">
                    <span className="app-dataset-sample-tag">示例</span>
                  </Tooltip>
                )}
                <DownOutlined className="app-dataset-arrow" />
              </button>
            </Dropdown>
          ) : null}
          {/* 「我的空间」在数据集与头像之间：先说明"在哪份数据里"，再给出同一份身份下的
              私有入口，最后是头像本身。顺序写在 DOM 里（见文件头注释）。 */}
          {beforeAvatar}
          <button
            type="button"
            className="app-user-avatar-button"
            onClick={() => navigate("/profile")}
            aria-label="进入我的资料"
          >
            <Avatar
              size={36}
              src={photo || undefined}
              // AntD 的 Avatar 在有 icon 时会**忽略** children，所以"姓名首字"和"兜底图标"
              // 只能二选一：有名字就用首字（更像头像），没名字才用图标。
              icon={!photo && !initial ? <UserOutlined /> : undefined}
              className="app-user-avatar"
              alt={displayName ? `${displayName}的头像` : "用户头像"}
            >
              {!photo && initial ? initial : undefined}
            </Avatar>
          </button>
          {switchError ? <span className="app-header-context-error">{switchError}</span> : null}
        </>
      )}
      <DatasetCreateModal
        open={createOpen}
        value={createName}
        confirmLoading={creating}
        onChange={setCreateName}
        onOk={() => void handleCreateDataset()}
        onCancel={() => {
          if (creating) return;
          setCreateOpen(false);
          setCreateName("");
        }}
      />
    </div>
  );
}
