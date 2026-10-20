// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体（R10）：上传字体文件，预览、导出 HTML 与导出 PDF 统一使用。
 *
 * 同源性要说清楚：选中的字体会被渲染层按用到的字形子集化，内嵌进预览 HTML，
 * 导出的 HTML 里也带着同一份子集，PDF 直接读同一个字体文件。**界面本身**（设置页、
 * 列表页）仍跟系统字体走——把"设置页没变"说成 bug 是最容易发生的误会。
 * 字体不随应用分发：一款中文字体动辄十几 MB，体积与授权都该由用户自己决定，
 * 所以这里只做"上传 → 选用"这一条路。
 *
 * 2026-10-20 两处交互调整：
 * 1. 删除不再是一颗裸露的红色垃圾桶（列表里既抢眼又容易误点），收进「···」菜单；
 * 2. 点字体名可以**先预览再决定**：弹窗里用该字体渲染一段示例，确认后再「设为当前」。
 */
import { DeleteOutlined, EyeOutlined, MoreOutlined, UploadOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Dropdown,
  Empty,
  Listy,
  Modal,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  activateResumeFont,
  deleteResumeFont,
  listResumeFonts,
  resumeFontPreviewUrl,
  uploadResumeFont,
  type ResumeFonts,
} from "../../api/settings";
import { ListyItem } from "../common/ListyItem";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResumeFontCard() {
  const { message, modal } = App.useApp();
  const [data, setData] = useState<ResumeFonts | null>(null);
  const [busy, setBusy] = useState(false);
  /** 正在预览的字体文件名；null = 弹窗关闭。 */
  const [previewName, setPreviewName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listResumeFonts());
    } catch {
      // 读不到（老后端）就当作没有自定义字体，不影响其它设置。
      setData({ items: [], active: null, max_bytes: 20 * 1024 * 1024 });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const item = await uploadResumeFont(file);
      message.success(`已上传「${item.name}」，点「设为当前」后预览与导出即生效`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传字体失败");
    } finally {
      setBusy(false);
    }
  };

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
      content: "删除后如果它正在使用，预览与导出会回到系统字体。",
      okText: "删除",
      cancelText: "取消",
      onOk: async () => {
        await deleteResumeFont(name);
        message.success("已删除");
        await load();
      },
    });
  };

  const items = data?.items ?? [];
  const activeName = data?.active ?? null;

  return (
    <Card className="settings-card" title="简历字体">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        用于预览、HTML 与 PDF：选中的字体在预览里立刻生效，导出的 HTML / PDF 也是同一款字。
        界面本身（设置页、列表页）仍使用系统字体。
        系统字体缺少你需要的字形（生僻字、繁体）时，上传一个字体文件即可。
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 12 }}>
        <Upload
          accept=".ttf,.otf,.ttc"
          showUploadList={false}
          beforeUpload={(file) => {
            void upload(file as File);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={busy}>
            上传字体（ttf / otf / ttc，≤20MB）
          </Button>
        </Upload>
        <Button disabled={!activeName} onClick={() => void activate(null)}>
          回到系统字体
        </Button>
      </Space>
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有上传字体，预览与导出使用系统自带的中文字体"
        />
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
                    {item.name}
                  </Button>
                  <Typography.Text type="secondary">{formatSize(item.size)}</Typography.Text>
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
                        {
                          key: "delete",
                          icon: <DeleteOutlined />,
                          label: "删除",
                          danger: true,
                        },
                      ],
                      onClick: ({ key }) => {
                        if (key === "preview") setPreviewName(item.name);
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
