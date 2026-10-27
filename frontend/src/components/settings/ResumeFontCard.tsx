// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体（R10）：选用一款字体，预览、导出 HTML 与导出 PDF 统一使用。
 *
 * 同源性要说清楚：选中的字体会被渲染层按用到的字形子集化，内嵌进预览 HTML，
 * 导出的 HTML 里也带着同一份子集，PDF 直接读同一个字体文件。**界面本身**（设置页、
 * 列表页）仍跟系统字体走——把"设置页没变"说成 bug 是最容易发生的误会。
 *
 * ## 字体从哪来（2026-11 起）
 *
 * **上传入口已下线**：`POST /settings/fonts` 仍在，但界面不再提供按钮（自备字体文件这条路
 * 对普通用户成本太高，且授权责任落在用户身上）。现在只有两条路：
 *
 * 1. **内置的思源黑体**，按需联网下载（约 32MB，SIL OFL 1.1，可商用）——见 `BuiltinFontRow`；
 * 2. **已导入的历史字体**：升级前导入过的文件仍在磁盘上，继续可用、可改名、可删除。
 *
 * 所以这一页的主语从"上传"变成了"选用"。
 *
 * 2026-10-20 两处交互调整：
 * 1. 删除不再是一颗裸露的红色垃圾桶（列表里既抢眼又容易误点），收进「···」菜单；
 * 2. 点字体名可以**先预览再决定**：弹窗里用该字体渲染一段示例，确认后再「设为当前」。
 */
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Dropdown, Input, Listy, Modal, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  activateResumeFont,
  deleteResumeFont,
  getBuiltinFont,
  listResumeFonts,
  renameResumeFont,
  type BuiltinFontStatus,
  type ResumeFonts,
} from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { ListyItem } from "../common/ListyItem";
import BuiltinFontRow from "./BuiltinFontRow";
import FontSampleModal from "./FontSampleModal";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 读一次字体列表。读不到（老后端没有这个接口、或请求失败）就当作没有自定义字体，
 * 不影响其它设置——这条降级是刻意保留的，不能因为接口报错就让整个设置页打不开。
 *
 * 兜底留在函数内部（`try` 而不是调用方的 `.catch`）：接口可能**同步**抛（模块里没有
 * 这个导出时就是这样），那种抛出连 promise 都拿不到。调用方因此只需要 `await`。
 */
async function fetchResumeFonts(): Promise<ResumeFonts> {
  try {
    return await listResumeFonts();
  } catch {
    return { items: [], active: null, max_bytes: 30 * 1024 * 1024 };
  }
}

/**
 * 读一次内置字体状态。同样把兜底留在函数内部：老后端没有 `/settings/fonts/builtin` 时
 * 返回 `null`，调用方据此**不渲染**内置那一行，其余设置照常可用。
 */
async function fetchBuiltinFont(): Promise<BuiltinFontStatus | null> {
  try {
    return await getBuiltinFont();
  } catch {
    return null;
  }
}

export default function ResumeFontCard() {
  useLocale();
  const { message, modal } = App.useApp();
  const [data, setData] = useState<ResumeFonts | null>(null);
  /** 内置（按需下载）字体状态；`null` = 该后端没有这个接口，整行不渲染。 */
  const [builtin, setBuiltin] = useState<BuiltinFontStatus | null>(null);
  /** 正在预览的字体文件名；null = 弹窗关闭。 */
  const [previewName, setPreviewName] = useState<string | null>(null);
  /** 正在重命名的那款字体：`{ name: 文件名, value: 输入中的展示名 }`。 */
  const [renameTarget, setRenameTarget] = useState<{ name: string; value: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  /**
   * 刚切换成功、清单还没重拉回来时的**乐观当前字体**。
   *
   * 没有它，"点了「设为当前」按钮没变化"会稳定复现：`activate()` 之后要等 `load()` 走一次
   * 网络，那一瞬间界面读到的还是旧的 `data.active`（2026-10-24 用户反馈）。
   * `null` = 没有待确认的覆盖值；`{ value: null }` = 明确切回了系统字体。
   */
  const [pendingActive, setPendingActive] = useState<{ value: string | null } | null>(null);

  /**
   * 重拉字体清单。内置行下载完成后也调它（清单里会多出这一款，`active` 也可能变了）。
   * 内置**状态**不在这里刷新：那份状态由 `BuiltinFontRow` 自己轮询，两件事不该互相触发。
   */
  const load = useCallback(async () => {
    setData(await fetchResumeFonts());
  }, []);

  // 挂载即并行读两份数据。请求与 setData 都在这里内联展开：`load()` 是 hook 内部的函数，
  // 规则无法证明它不会同步改状态，内联成"await 之后才 setData"就不存在这个疑问。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [next, builtinStatus] = await Promise.all([fetchResumeFonts(), fetchBuiltinFont()]);
      // 卸载后不再写状态（列表页来回切时不至于对已卸载组件 setState）。
      if (!cancelled) {
        setData(next);
        setBuiltin(builtinStatus);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activate = async (name: string | null) => {
    try {
      await activateResumeFont(name);
      // 先乐观改本地值再刷新：按钮与「当前使用」标签必须当场变，不能让用户对着
      // 一颗没反应的按钮猜"到底生效没生效"。
      setPendingActive({ value: name });
      message.success(name ? t("fonts.card.activated", { name }) : t("fonts.card.reset-to-system"));
      setPreviewName(null);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("fonts.card.activate-failed"));
    } finally {
      // 清单已经是服务端的新结果，覆盖值完成使命（失败时也要清，界面回到真实状态）。
      setPendingActive(null);
    }
  };

  const remove = (name: string) => {
    modal.confirm({
      title: t("fonts.card.delete-title", { name }),
      // 直删，没有回收站：这句话必须写明"没有恢复入口"，否则用户会按"删除先进回收站"的
      // 既有印象去找，而字体文件不在回收站里。
      content: t("fonts.card.delete-body"),
      okText: t("common.action.delete"),
      cancelText: t("common.action.cancel"),
      onOk: async () => {
        await deleteResumeFont(name);
        message.success(t("fonts.card.deleted"));
        await load();
      },
    });
  };

  /** 只改展示名：文件名与所有已引用它的简历都不动（后端只写 names.json）。 */
  const submitRename = async () => {
    if (!renameTarget) return;
    const label = renameTarget.value.trim();
    if (!label) {
      message.warning(t("fonts.card.name-required"));
      return;
    }
    setRenameBusy(true);
    try {
      await renameResumeFont(renameTarget.name, label);
      message.success(t("fonts.card.renamed"));
      setRenameTarget(null);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("fonts.card.rename-failed"));
    } finally {
      setRenameBusy(false);
    }
  };

  // 内置条目（`builtin: true`）由上面的内置行专门渲染：下载、设为当前、体积说明都在那里。
  // 若把它同时塞进下面这张历史列表，它会出现两次，还会多出「删除 / 重命名」这两条对内置
  // 文件没有意义的操作——所以这里只列**用户自己导入过的**字体。
  const items = (data?.items ?? []).filter((item) => !item.builtin);
  // 乐观值优先：切换成功后立刻反映，不必等清单回来。
  const activeName = pendingActive ? pendingActive.value : (data?.active ?? null);

  return (
    <Card className="settings-card settings-font-card" title={t("fonts.card.title")}>
      <Typography.Paragraph type="secondary" className="settings-font-intro">
        {t("fonts.card.description")}
      </Typography.Paragraph>

      {/* 内置字体排在最前：它是"开箱即可用"的那一款，历史导入的字体随后。
          `activeName` 只用于删除成功后的提示语（删的正是当前字体 → 简历已回到系统字体）。 */}
      <BuiltinFontRow status={builtin} onChanged={() => void load()} activeName={activeName} />

      {items.length === 0 ? (
        // 内置条目常驻，所以这里不再是"什么都没有"的空态：只说清"还没有导入其它字体"。
        <Typography.Text type="secondary" className="settings-font-empty">
          {t("fonts.card.empty")}
        </Typography.Text>
      ) : (
        <Listy
          className="settings-font-list"
          items={items}
          rowKey={(item) => item.name}
          itemRender={(item) => (
            <ListyItem
              actions={[
                <Button
                  key="activate"
                  size="small"
                  disabled={item.name === activeName || undefined}
                  icon={item.name === activeName ? <CheckOutlined /> : undefined}
                  onClick={() => void activate(item.name)}
                >
                  {t("fonts.builtin.activate")}
                </Button>,
                // 删除收进「···」：原来是一颗裸露的红色垃圾桶，密集列表里既抢眼又容易误点。
                <Dropdown
                  key="more"
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "preview",
                        icon: <EyeOutlined />,
                        label: t("fonts.card.menu-preview"),
                      },
                      { key: "rename", icon: <EditOutlined />, label: t("fonts.card.menu-rename") },
                      {
                        key: "delete",
                        icon: <DeleteOutlined />,
                        label: t("common.action.delete"),
                        danger: true,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key === "preview") setPreviewName(item.name);
                      else if (key === "rename")
                        setRenameTarget({ name: item.name, value: item.display_name });
                      else remove(item.name);
                    },
                  }}
                >
                  <Button
                    size="small"
                    icon={<MoreOutlined />}
                    aria-label={t("fonts.card.more-aria", { name: item.name })}
                  />
                </Dropdown>,
              ]}
            >
              <div className="settings-font-title">
                {/* 点名字直接预览：用户要在「设为当前」之前先确认字形，不该逼他先切换。 */}
                <Button
                  type="link"
                  className="table-text-link settings-font-name"
                  onClick={() => setPreviewName(item.name)}
                >
                  {item.display_name || item.name}
                </Button>
                {item.name === activeName ? (
                  <Tag color="blue">{t("fonts.card.active-tag")}</Tag>
                ) : null}
              </div>
              {/* 展示名可以随便起，但**原始文件名要一直看得见**：它才是磁盘上的东西，
                  也是排查"这份简历用的是哪个字体文件"时唯一的线索。 */}
              <div className="settings-font-meta">
                <span>{formatSize(item.size)}</span>
                {(item.display_name || item.name) !== item.name ? <span>{item.name}</span> : null}
              </div>
            </ListyItem>
          )}
        />
      )}

      {/* 页脚与列表之间加一条分隔线：原来「回到系统字体」和"还没有导入其它字体"挤在同一行，
          读起来像按钮的说明文字（2026-10-24 用户截图）。现在两者各归各位。 */}
      <div className="settings-font-footer">
        <Button disabled={!activeName || undefined} onClick={() => void activate(null)}>
          {t("fonts.card.reset")}
        </Button>
        <Typography.Text type="secondary" className="settings-font-footnote">
          {t("fonts.card.reset-hint")}
        </Typography.Text>
      </div>

      <Modal
        open={renameTarget !== null}
        title={t("fonts.card.rename-title")}
        onCancel={() => setRenameTarget(null)}
        onOk={() => void submitRename()}
        confirmLoading={renameBusy}
        okText={t("common.action.save")}
        cancelText={t("common.action.cancel")}
        destroyOnHidden
      >
        <Input
          aria-label={t("fonts.card.name-aria")}
          value={renameTarget?.value ?? ""}
          maxLength={40}
          placeholder={t("fonts.card.name-placeholder")}
          onChange={(event) =>
            setRenameTarget((current) =>
              current ? { ...current, value: event.target.value } : current,
            )
          }
          onPressEnter={() => void submitRename()}
        />
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {t("fonts.card.rename-hint", { name: renameTarget?.name ?? "" })}
        </Typography.Paragraph>
      </Modal>

      {/* 样张：只读弹窗，与内置字体那一行共用同一个组件（四行固定内容 + 设为当前）。
          点字体名先看字形，确认后再切换——这是 2026-10-20 那两处交互调整的第二条。 */}
      <FontSampleModal
        name={previewName}
        active={previewName !== null && previewName === activeName}
        onActivate={() => {
          if (previewName) void activate(previewName);
        }}
        onClose={() => setPreviewName(null)}
      />
    </Card>
  );
}
