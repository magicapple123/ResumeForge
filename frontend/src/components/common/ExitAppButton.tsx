/**
 * 退出应用：停掉前端与后端进程，并把页面切成"已退出"状态。
 *
 * 为什么由后端负责退出：前端只是浏览器里的一个页面，关掉它并不会停止任何服务——用户
 * 真正想停掉的是那两个占用端口、还在跑数据库的开发服务。所以这里调用
 * `/api/system/shutdown`：后端会先让启动器按记录停掉 Vite 进程树，再自己优雅退出。
 *
 * 桌面壳（`window.splash.isDesktop === true`，由桌面批次注入）里不一样：`shutdownApp`
 * 停掉后端之后，壳进程还开着——退出成功要追加调 `window.splash.quitApp()` 让壳一并
 * 退出，提示文案也面向"桌面快捷方式"而不是"start.cmd/标签页"。
 */
import { LogoutOutlined } from "@ant-design/icons";
import { App, Button, Result, Tooltip } from "antd";
import { useState } from "react";
import { shutdownApp } from "../../api/system";

/** 桌面壳的确认/成功文案（浏览器路径维持原有措辞）。 */
const DESKTOP_CONFIRM_TEXT =
  "应用会完全退出，后台服务一并停止。再次使用请从桌面快捷方式启动简历通。";
const DESKTOP_EXITED_TEXT = "前端、后端与桌面壳进程都已停止。再次使用请从桌面快捷方式启动简历通。";

export default function ExitAppButton() {
  const { modal, message } = App.useApp();
  const [exited, setExited] = useState(false);
  const [exiting, setExiting] = useState(false);
  // 读取一次即可：splash 是壳进程注入的静态桥，页面生命周期内不会变。
  const isDesktop = Boolean(window.splash?.isDesktop);

  const exit = () => {
    modal.confirm({
      title: "退出简历通？",
      className: "rf-modal-danger",
      content: isDesktop
        ? DESKTOP_CONFIRM_TEXT
        : "前端与后端进程都会停止，当前页面上的查询与生成立即不可用（浏览器不允许脚本关闭本页，请顺手关掉这个标签页）。下次使用请在项目目录重新运行 start.cmd。",
      okText: "退出",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setExiting(true);
        try {
          const result = await shutdownApp();
          message.success(result.message || "应用正在退出");
        } catch (error) {
          message.error(
            error instanceof Error
              ? `${error.message}（也可以直接关闭后端窗口）`
              : "退出失败，也可以直接关闭后端窗口",
          );
          setExiting(false);
          // 抛出让 Modal 保持打开：失败时用户需要看到发生了什么。
          throw error;
        }
        setExited(true);
        if (isDesktop) {
          // 桌面壳：后端已停，把壳进程也退掉（桥调用失败不阻断收尾——遮罩已经
          // 盖住界面，用户可以手动关窗口）。
          try {
            window.splash?.quitApp?.();
          } catch {
            // 忽略：见上。
          }
          return;
        }
        // 浏览器路径（行为不变）：试一次关闭，多数浏览器只允许脚本关闭"自己打开的"
        // 窗口，被拒也无妨——页面上已经写明"请顺手关掉这个标签页"。
        window.setTimeout(() => window.close(), 600);
      },
    });
  };

  if (exited) {
    return (
      <div className="app-exited-overlay">
        <Result
          status="success"
          title="简历通已退出"
          subTitle={
            isDesktop
              ? DESKTOP_EXITED_TEXT
              : "前端与后端进程都已停止，现在可以关闭这个标签页。要再次使用，请在项目目录运行 start.cmd。"
          }
        />
      </div>
    );
  }

  return (
    <Tooltip title="退出应用（停止前端与后端进程）">
      <Button
        className="app-exit-button"
        type="text"
        size="small"
        icon={<LogoutOutlined />}
        loading={exiting}
        onClick={exit}
        aria-label="退出应用"
      >
        <span className="app-exit-label">退出</span>
      </Button>
    </Tooltip>
  );
}
