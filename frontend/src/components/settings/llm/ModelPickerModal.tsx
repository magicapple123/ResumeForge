/**
 * 选模型弹窗：展示「获取可用模型」拉到的模型列表，点「使用」回填表单。
 * （自 LLMConfigCard 拆出，逐字搬运，行为等价。）
 */
import { Button, Listy, Modal, Typography } from "antd";
import { ListyItem } from "../../common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../common/listyPadding";

export function ModelPickerModal({
  open,
  modelsMessage,
  modelOptions,
  onPick,
  onClose,
}: {
  open: boolean;
  modelsMessage: string;
  modelOptions: string[];
  onPick: (model: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="选择模型" open={open} footer={null} onCancel={onClose}>
      <Typography.Paragraph type="secondary">{modelsMessage}</Typography.Paragraph>
      <Listy
        height={360}
        items={modelOptions}
        rowKey={(model) => model}
        styles={{
          root: { overflowX: "hidden" },
          item: { ...LISTY_ITEM_PADDING_SMALL },
        }}
        itemRender={(model) => (
          <ListyItem
            actions={[
              <Button
                key="pick"
                type="link"
                size="small"
                onClick={() => {
                  onPick(model);
                  onClose();
                }}
              >
                使用
              </Button>,
            ]}
          >
            <Typography.Text code>{model}</Typography.Text>
          </ListyItem>
        )}
      />
    </Modal>
  );
}
