/** 投投的低打扰提示气泡。 */

interface TouTouTipProps {
  onClose: () => void;
  text: string;
}

export default function TouTouTip({ onClose, text }: TouTouTipProps) {
  return (
    <div className="tt-tip" role="status" aria-live="polite">
      <span>{text}</span>
      <button type="button" className="tt-tip-close" aria-label="关闭投投提示" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
