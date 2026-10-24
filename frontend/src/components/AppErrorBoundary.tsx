// SPDX-License-Identifier: Apache-2.0
import { Button, Result, Space, Typography } from "antd";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { t } from "../i18n";
import { recordClientDiagnostic } from "../utils/clientDiagnostics";

interface Props {
  children: ReactNode;
  onReload?: () => void;
}

interface State {
  failed: boolean;
  message: string;
}

/**
 * 动态 import 失败（懒加载的页面代码没取到）。
 *
 * 为什么要单独认这一类：它的**处置方式与普通渲染异常不同**。渲染异常刷新一下多半就好了；
 * 而这条错误在开发服务器上常常是"文件名改过/移过之后，dev server 缓存了旧的模块解析"——
 * 此时刷新页面永远无效，必须重启前端 dev server。实测踩过：把 `recordDetail.ts` 改名成
 * `recordDetailCore.ts` 之后，正在跑的 Vite 仍按旧解析去请求已删除的文件，投递台等六个页面
 * 全部变成"页面暂时无法显示"，刷新毫无作用。
 *
 * 判据用各浏览器/打包器的稳定文案；认不出来就退化成通用文案——绝不硬猜。
 */
const MODULE_LOAD_FAILURE_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
];

function isModuleLoadFailure(message: string): boolean {
  return MODULE_LOAD_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return { failed: true, message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ResumeForge UI crashed", error, info);
    recordClientDiagnostic("ui.crash", {
      error: error.name,
      message: error.message,
      component_stack: info.componentStack?.slice(0, 160),
    });
  }

  private reload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  /**
   * 就地重试：清掉错误态，让子树重新渲染。
   *
   * 这对"动态 import 失败"是**真的重试**而不是只把提示藏起来——`pages/registry.ts`
   * 的 `lazyPage` 在失败时会换一个新的 `lazy()`，所以重新渲染会重新发起 chunk 请求。
   * 普通渲染异常没有这条保证（同样的 props 再渲染一次大概率还是崩），因此「重试」只
   * 出现在模块加载失败这一类，普通异常仍以刷新为主。
   */
  private retry = (): void => {
    this.setState({ failed: false, message: "" });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    const moduleLoadFailed = isModuleLoadFailure(this.state.message);

    return (
      <Result
        status="500"
        title={moduleLoadFailed ? "页面代码没能加载完整" : "页面暂时无法显示"}
        subTitle={
          moduleLoadFailed
            ? "这通常是页面代码没取到（网络抖动、前端开发服务器刚重启，或它缓存了已改名/已移动的文件）。先点「重试」——它会重新取一次；若仍失败，再刷新或重启前端开发服务器（关掉窗口后重新运行 start.cmd）。"
            : "界面运行时发生异常，请刷新后再试。"
        }
        extra={
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {moduleLoadFailed && (
              <Button type="primary" onClick={this.retry}>
                {t("common.retry")}
              </Button>
            )}
            <Button type={moduleLoadFailed ? "default" : "primary"} onClick={this.reload}>
              刷新
            </Button>
            {this.state.message && (
              // 把原始报错留在页面上：这类问题以前只能靠猜，一句"运行时异常"提供不了任何线索。
              // 本地单用户工具，报错文本里不含密钥或个人信息。
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                原因：{this.state.message}
              </Typography.Text>
            )}
          </Space>
        }
      />
    );
  }
}
