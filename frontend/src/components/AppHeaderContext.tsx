/**
 * 页头右侧的「当前数据集 + 用户头像」。
 *
 * 两件事放在一起，因为它们回答的是同一个问题：**我现在是在什么上下文里操作**。
 * - 数据集：简历通支持多套互相独立的数据集（工作一份、私人一份），而界面其余部分长得
 *   一模一样，切错数据集会产生"我的简历怎么不见了"这类误会。
 * - 头像：用「我的资料」里**当前启用的那张照片**，一眼就能认出这是谁的那份数据。
 *
 * 两个刻意的做法：
 * 1. 数据集在这里可以直接切换，但切换成功后会整页重载，保证岗位、资料和缓存都来自新数据集。
 * 2. **头像不出本机**。照片存在本地数据库里，这里只是把它显示出来，不发给任何模型。
 */
import { DatabaseOutlined, DownOutlined, HomeOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Skeleton, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getProfile } from "../api/profile";
import { activateDataset, listDatasets } from "../api/settings";
import type { Profile } from "../types";
import type { DatasetInfo } from "../types/settings";
import { reloadPage } from "../utils/navigation";
import { saveActiveDatasetId } from "../utils/datasetScope";

export default function AppHeaderContext() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [, setDatasetCount] = useState(0); // 计数原先只用于悬停提示，提示移除后仅保留写入
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState("");

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

  const datasetMenuItems = useMemo<MenuProps["items"]>(() => {
    const items: MenuProps["items"] = datasets.map((item) => ({
      key: item.id,
      label: (
        <span className="app-dataset-menu-label">
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
              menu={{
                items: datasetMenuItems,
                onClick: ({ key }) => {
                  // 「回到我的数据」是动作入口：解析出目标数据集 id，仍走切换流程。
                  const targetId = key.startsWith("return-main:")
                    ? key.slice("return-main:".length)
                    : key;
                  void handleDatasetSwitch(targetId);
                },
              }}
            >
              <button
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
    </div>
  );
}
