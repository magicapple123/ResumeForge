// SPDX-License-Identifier: Apache-2.0
/**
 * 页头右侧动作区（R21 抽出，A3 起承载主题切换）：主题、模型切换、我的空间、
 * 数据集/头像、后台任务、源码与退出。
 *
 * 单独成文件是为了让 App.tsx 留在单文件行数预算内；这里只做组合，不持有状态。
 * 全站搜索的放大镜已从这里移除（D）：⌘/Ctrl+K 与弹层由 GlobalOverlays 统一挂载。
 */
import { GithubOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import AppHeaderContext from "./AppHeaderContext";
import BackgroundTasksIndicator from "./BackgroundTasksIndicator";
import ExitAppButton from "./common/ExitAppButton";
import ModelProfileSelect from "./ModelProfileSelect";
import MySpaceMenu from "./navigation/MySpaceMenu";
import ThemeSwitch from "./ThemeSwitch";
import { APP_NAME, GITHUB_REPO } from "../config";

interface Props {
  hiddenKeys: readonly string[];
  /** 点击 GitHub 图标时顺便弹「点个 Star」提示。 */
  onStarClick: () => void;
}

export default function AppHeaderActions({ hiddenKeys, onStarClick }: Props) {
  return (
    <div className="app-header-actions">
      {/* 主题三档（A3）：放在最前，与语言/空间等"显示偏好"类动作归在一组。 */}
      <ThemeSwitch />
      {/* 模型切换放在数据集与头像的**左侧**：先说明"用哪套模型"，再说"在哪份数据里"。
          「我的空间」不在这里，而是走 AppHeaderContext 的 beforeAvatar 插槽——视觉顺序
          要的是 `[数据集][我的空间][头像]`，而它们是两个 flex 容器，`order` 跨不过去。 */}
      <ModelProfileSelect />
      <AppHeaderContext beforeAvatar={<MySpaceMenu hiddenKeys={hiddenKeys} />} />
      {/* 有任务在跑时才出现：平时页头不该多一个空按钮。 */}
      <BackgroundTasksIndicator />
      <span className="app-header-divider" aria-hidden="true" />
      {/* GitHub 入口在页头右上角：与「退出」并排，符合"关于本项目"这类低频入口的习惯。 */}
      {GITHUB_REPO && (
        <Tooltip title="在 GitHub 上查看源码 / 反馈问题">
          <Button
            className="app-repo-button"
            type="text"
            icon={<GithubOutlined />}
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`在 GitHub 上查看 ${APP_NAME} 源码`}
            onClick={onStarClick}
          />
        </Tooltip>
      )}
      <ExitAppButton />
    </div>
  );
}
