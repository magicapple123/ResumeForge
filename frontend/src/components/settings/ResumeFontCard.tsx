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
import { DeleteOutlined, EditOutlined, EyeOutlined, MoreOutlined } from "@ant-design/icons";
import { App, Button, Card, Dropdown, Input, Listy, Modal, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  activateResumeFont,
  deleteResumeFont,
  getBuiltinFont,
  listResumeFonts,
  renameResumeFont,
  resumeFontPreviewUrl,
  type BuiltinFontStatus,
  type ResumeFonts,
} from "../../api/settings";
import { t } from "../../i18n";
import { ListyItem } from "../common/ListyItem";
import BuiltinFontRow from "./BuiltinFontRow";

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
      message.success(name ? `已切换到「${name}」` : "已回到系统字体");
      setPreviewName(null);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换字体失败");
    }
  };

  const remove = (name: string) => {
    modal.confirm({
      title: `删除字体「${name}」？`,
      // 直删，没有回收站：这句话必须写明"没有恢复入口"，否则用户会按"删除先进回收站"的
      // 既有印象去找，而字体文件不在回收站里。
      content: t("fonts.card.delete-body"),
      okText: "删除",
      cancelText: "取消",
      onOk: async () => {
        await deleteResumeFont(name);
        message.success("已删除这个字体");
        await load();
      },
    });
  };

  /** 只改展示名：文件名与所有已引用它的简历都不动（后端只写 names.json）。 */
  const submitRename = async () => {
    if (!renameTarget) return;
    const label = renameTarget.value.trim();
    if (!label) {
      message.warning("字体名称不能为空");
      return;
    }
    setRenameBusy(true);
    try {
      await renameResumeFont(renameTarget.name, label);
      message.success("已重命名字体");
      setRenameTarget(null);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重命名字体失败");
    } finally {
      setRenameBusy(false);
    }
  };

  // 内置条目（`builtin: true`）由上面的内置行专门渲染：下载、设为当前、体积说明都在那里。
  // 若把它同时塞进下面这张历史列表，它会出现两次，还会多出「删除 / 重命名」这两条对内置
  // 文件没有意义的操作——所以这里只列**用户自己导入过的**字体。
  const items = (data?.items ?? []).filter((item) => !item.builtin);
  const activeName = data?.active ?? null;

  return (
    <Card className="settings-card" title="简历字体">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("fonts.card.description")}
      </Typography.Paragraph>
      {/* 内置字体排在最前：它是"开箱即可用"的那一款，历史导入的字体随后。 */}
      <BuiltinFontRow status={builtin} onChanged={() => void load()} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Button disabled={!activeName} onClick={() => void activate(null)}>
          回到系统字体
        </Button>
      </Space>
      {items.length === 0 ? (
        // 内置条目常驻，所以这里不再是"什么都没有"的空态：只说清"还没有导入其它字体"。
        <Typography.Text type="secondary">{t("fonts.card.empty")}</Typography.Text>
      ) : (
        <Listy
          items={items}
          rowKey={(item) => item.name}
          itemRender={(item) => (
            <ListyItem>
              <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                <Space>
                  {/* 点名字直接预览：用户要在「设为当前」之前先确认字形，不该逼他先切换。 */}
                  <Button
                    type="link"
                    className="table-text-link"
                    onClick={() => setPreviewName(item.name)}
                  >
                    {item.display_name || item.name}
                  </Button>
                  <Typography.Text type="secondary">{formatSize(item.size)}</Typography.Text>
                  {/* 展示名可以随便起，但**原始文件名要一直看得见**：它才是磁盘上的东西，
                      也是排查"这份简历用的是哪个字体文件"时唯一的线索。 */}
                  {(item.display_name || item.name) !== item.name ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.name}
                    </Typography.Text>
                  ) : null}
                  {item.name === activeName ? <Tag color="blue">当前使用</Tag> : null}
                </Space>
                <Space size={4}>
                  <Button
                    size="small"
                    disabled={item.active}
                    onClick={() => void activate(item.name)}
                  >
                    设为当前
                  </Button>
                  {/* 删除收进「···」：原来是一颗裸露的红色垃圾桶，密集列表里既抢眼又容易误点。 */}
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        { key: "preview", icon: <EyeOutlined />, label: "预览字体" },
                        { key: "rename", icon: <EditOutlined />, label: "重命名" },
                        {
                          key: "delete",
                          icon: <DeleteOutlined />,
                          label: "删除",
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
                      aria-label={`更多字体操作（${item.name}）`}
                    />
                  </Dropdown>
                </Space>
              </Space>
            </ListyItem>
          )}
        />
      )}

      <Modal
        open={renameTarget !== null}
        title="重命名字体"
        onCancel={() => setRenameTarget(null)}
        onOk={() => void submitRename()}
        confirmLoading={renameBusy}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          aria-label="字体名称"
          value={renameTarget?.value ?? ""}
          maxLength={40}
          placeholder="给这款字体起个名字"
          onChange={(event) =>
            setRenameTarget((current) =>
              current ? { ...current, value: event.target.value } : current,
            )
          }
          onPressEnter={() => void submitRename()}
        />
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0", fontSize: 12 }}>
          只改显示名。原文件名保持不变：{renameTarget?.name}
        </Typography.Paragraph>
      </Modal>

      <Modal
        open={previewName !== null}
        title={previewName ? `字体预览「${previewName}」` : "字体预览"}
        onCancel={() => setPreviewName(null)}
        destroyOnHidden
        width={640}
        footer={[
          <Button key="close" onClick={() => setPreviewName(null)}>
            关闭
          </Button>,
          <Button
            key="use"
            type="primary"
            disabled={previewName === null || previewName === activeName}
            onClick={() => previewName && void activate(previewName)}
          >
            {previewName === activeName ? "当前已在使用" : "设为当前"}
          </Button>,
        ]}
      >
        {previewName ? (
          <>
            {/* 字体文件同源提供，直接喂给 @font-face；不下载到内存再转 base64。 */}
            <style>
              {`@font-face{font-family:"rf-font-preview";src:url("${resumeFontPreviewUrl(
                previewName,
              )}");font-display:swap;}`}
            </style>
            <div
              className="font-preview-sample"
              style={{ fontFamily: '"rf-font-preview", "Microsoft YaHei", sans-serif' }}
            >
              <div className="font-preview-sample-title">张三 · 后端开发工程师</div>
              <div className="font-preview-sample-meta">
                2022.07 – 2024.09 ｜ 示例科技有限公司 ｜ 高级后端工程师
              </div>
              <p className="font-preview-sample-body">
                负责核心交易链路的接口设计与性能优化，QPS 从 1,200 提升到 8,500； 主导 Python /
                FastAPI 服务拆分，P99 延迟下降 42%。
              </p>
              <p className="font-preview-sample-body">
                ABCDEFG abcdefg 0123456789 ！？、；：「」（）——·…
              </p>
            </div>
            <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0", fontSize: 12 }}>
              预览只改变这段示例文字；点「设为当前」后，简历预览、导出 HTML 与 PDF 才会一起使用它。
            </Typography.Paragraph>
          </>
        ) : null}
      </Modal>
    </Card>
  );
}
