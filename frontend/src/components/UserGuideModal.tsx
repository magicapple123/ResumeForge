// SPDX-License-Identifier: Apache-2.0
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  FormOutlined,
  PlayCircleOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Divider, Modal, Space, Steps, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
// 走 import 让 Vite 按 `base` 重写前缀，别写死 "/resumeforge-icon.png"
// （在线体验产物部署在 Pages 子路径下，绝对路径会 404）。理由同 App.tsx 侧栏图标。
import brandIcon from "../assets/resumeforge-icon.png";
import { loadSampleDataset } from "../api/settings";
import { QUICK_START_PATHS } from "./quickStartPaths";
import type { QuickStartPath } from "./quickStartPaths";
import { GUIDE_STEPS } from "./userGuideSteps";

/** 把文案里的 `**强调**` 渲染成粗体。
 *
 * 指南正文此前是当纯文本渲染的，于是 `**事实台账**` 在界面上原样显示成带星号的
 * `**事实台账**`——既难看又让人以为写错了。这里做最小解析：只认成对出现的 `**`，
 * 别的都当普通文本。**不引入 markdown 依赖**，这条规则只服务这两种长度的一句话。
 */
function renderEmphasis(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    // split 带捕获组时，奇数下标就是被 `**` 包住的那段。
    index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
  );
}

/** 「快速开始」的一条路径卡：数据见 ``quickStartPaths.ts``，这里只做渲染与分发。 */
interface UserGuideModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  /** 载入示例成功后的收尾（默认整页刷新）；测试里注入替身避免 jsdom 导航。 */
  onSampleLoaded?: () => void;
  /** 首次自动弹出时先给「快速开始」三路径首屏；侧栏重开不传，行为与从前一致。 */
  initialQuickStart?: boolean;
}

export default function UserGuideModal({
  open,
  onClose,
  onNavigate,
  onSampleLoaded = () => window.location.reload(),
  initialQuickStart = false,
}: UserGuideModalProps) {
  const { message } = AntdApp.useApp();
  const [current, setCurrent] = useState(0);
  // 弹窗内容容器：打开时把初始焦点收进来（而非 antd 默认放进右上角关闭按钮），
  // 否则弹窗一出现关闭按钮就顶着全局 :focus-visible 的焦点环，看着像误触。
  // tabIndex=-1 让它可编程聚焦但不进 Tab 序；键盘 Tab 的焦点环不受影响。
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 「快速开始」→ 完整 8 步：用户手动切走后就留在步骤视图，本次打开不再弹回。
  const [view, setView] = useState<"quick-start" | "steps">(
    initialQuickStart ? "quick-start" : "steps",
  );
  const [loadingSample, setLoadingSample] = useState(false);
  const step = GUIDE_STEPS[current];
  const StepIcon = step.icon;
  const isLast = current === GUIDE_STEPS.length - 1;

  // 每次打开都回到第一步（快速开始与否随 initialQuickStart 决定）。
  // Compiler 规范：随 prop 变化的重置用渲染期守卫式调整。
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setCurrent(0);
      setView(initialQuickStart ? "quick-start" : "steps");
    }
  }

  // 打开时把焦点落到内容容器上。autoFocus 只在挂载时生效（antd Modal 关闭后 DOM
  // 保留、重开不重挂），所以用 effect 覆盖「每次打开」；Modal 内容随 motion 在
  // 首个 commit 之后才挂上（此刻 ref 还是空），用 rAF 重试几次直到可聚焦。用户若
  // 已把焦点移进弹窗（例如 Tab 进了按钮）则不抢。
  useEffect(() => {
    if (!open) return undefined;
    let raf = 0;
    let attempts = 0;
    const tryFocus = () => {
      const container = contentRef.current;
      if (container) {
        if (!container.contains(document.activeElement)) {
          container.focus({ preventScroll: true });
        }
        return;
      }
      if (attempts < 10) {
        attempts += 1;
        raf = requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const goToStepPage = () => {
    onClose();
    onNavigate(step.path);
  };

  const goToQuickStartPath = (item: QuickStartPath) => {
    if (item.key === "sample") {
      void loadSample();
      return;
    }
    onClose();
    onNavigate(item.path);
  };

  /**
   * 一键体验：写入「体验示例」独立数据集并切换过去（主数据不受影响），然后整页
   * 刷新——首启动时各页面已经按空数据集取过数，SPA 内导航不会触发重取，整页刷新
   * 是让"所有视图都落到示例数据上"最可靠的方式。
   */
  const loadSample = async () => {
    if (loadingSample) return;
    setLoadingSample(true);
    try {
      const result = await loadSampleDataset();
      // 后端在已有「体验示例」数据集时会复用而不是再建一份（reused=true）——
      // 这时说"已创建/已就绪"是在撒谎，用户会以为又多了一份数据。
      message.success(result.reused ? "已回到体验示例数据" : "示例数据已就绪，正在进入首页");
      onClose();
      onSampleLoaded();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "示例数据载入失败");
      setLoadingSample(false);
    }
  };

  const showQuickStart = view === "quick-start";

  return (
    <Modal
      className="user-guide-modal"
      open={open}
      title={
        <Space size={10}>
          <img className="user-guide-brand-image" src={brandIcon} alt="" />
          <span>欢迎使用简历通</span>
        </Space>
      }
      // 720 → 880：左导航列固定 168px，所以多出来的宽度**全给正文**——720 时正文只剩
      // 约 400px，一条要点要折三四行，看着就"拥挤"；880 下多数要点一两行就放得下。
      // maxWidth 兜住窄窗口：antd 的 Modal 本身不会自动限宽，不兜的话在 800px 的窗口里
      // 会横向溢出。
      width={880}
      style={{ maxWidth: "calc(100vw - 32px)" }}
      // 弹窗自身滚动：步骤多、要点长的内容只滚弹窗内部，卡片整体始终完整呈现在视口内。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      onCancel={onClose}
      footer={
        showQuickStart ? (
          <div className="user-guide-footer">
            <Button onClick={onClose}>稍后查看</Button>
            <Button type="link" onClick={() => setView("steps")}>
              查看完整指南（8 步）
            </Button>
          </div>
        ) : (
          <div className="user-guide-footer">
            <Button
              icon={<PlayCircleOutlined />}
              loading={loadingSample}
              onClick={() => void loadSample()}
            >
              载入示例数据体验
            </Button>
            <Button onClick={onClose}>稍后查看</Button>
            <Space wrap>
              <Button
                disabled={current === 0}
                icon={<ArrowLeftOutlined />}
                onClick={() => setCurrent(current - 1)}
              >
                上一步
              </Button>
              <Button type="link" icon={<FormOutlined />} onClick={goToStepPage}>
                {step.actionLabel}
              </Button>
              {isLast ? (
                <Button type="primary" icon={<CheckOutlined />} onClick={onClose}>
                  开始使用
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  onClick={() => setCurrent(current + 1)}
                >
                  下一步
                </Button>
              )}
            </Space>
          </div>
        )
      }
    >
      {/* 内容容器接收初始焦点（见 contentRef 说明），两种视图都包在同一容器里。 */}
      <div ref={contentRef} className="user-guide-modal-content" tabIndex={-1}>
        {showQuickStart ? (
          /* 首启动首屏：三条都通向"第一份可交付简历"，选一条顺的走；
           完整 8 步保留在「查看完整指南」后面，一步不少。 */
          <section className="user-guide-quickstart" aria-live="polite">
            <Typography.Title level={4}>从这里开始</Typography.Title>
            <Typography.Paragraph className="user-guide-description">
              三条路都通向你的第一份可交付简历，选一条顺的走。
            </Typography.Paragraph>
            <div className="user-guide-quickstart-paths">
              {QUICK_START_PATHS.map((item) => {
                const PathIcon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="user-guide-quickstart-path"
                    disabled={item.key === "sample" && loadingSample}
                    onClick={() => goToQuickStartPath(item)}
                  >
                    <span className="user-guide-quickstart-icon" aria-hidden="true">
                      <PathIcon />
                    </span>
                    <span className="user-guide-quickstart-copy">
                      <span className="user-guide-quickstart-lead">{item.lead}</span>
                      <span className="user-guide-quickstart-text">{item.text}</span>
                    </span>
                    <RightOutlined className="user-guide-quickstart-arrow" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          /* 步骤竖排在左侧当导航，内容在右侧。
          横排一行的做法在模块变多之后标题会互相挤压（截图反馈"小标题有点拥挤"）：
          9 个步骤平分 720px，每个标题只剩 70 多像素，中文标题被迫折成两三行。
          竖排后每个标题独占一行，再加模块也不用重新排版。 */
          <div className="user-guide-body">
            <Steps
              className="user-guide-steps"
              orientation="vertical"
              size="small"
              current={current}
              items={GUIDE_STEPS.map(({ title }) => ({ title }))}
              onChange={setCurrent}
            />
            <Divider orientation="vertical" className="user-guide-divider" />
            <section className="user-guide-step-content" aria-live="polite">
              <div className="user-guide-step-icon" aria-hidden="true">
                <StepIcon />
              </div>
              <div className="user-guide-step-copy">
                <Typography.Title level={4}>{step.heading}</Typography.Title>
                <Typography.Paragraph className="user-guide-description">
                  {renderEmphasis(step.description)}
                </Typography.Paragraph>
                <ul className="user-guide-points">
                  {step.points.map((point) => (
                    <li key={point.lead}>
                      <span className="user-guide-point-lead">{point.lead}</span>
                      <span className="user-guide-point-text">{renderEmphasis(point.text)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}
