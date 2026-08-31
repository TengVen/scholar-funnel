"use client";

import { useRef } from "react";
import { FileUp, Loader2 } from "lucide-react";

/**
 * 中栏顶部上传条：无 PDF 可用（非 arXiv / 未上传）时提示补全全文。
 * 上传是显式动作：成功后由调用方自动触发全文级重算（无需再点"重新分析"）。
 * 纯展示组件：文件选择后交给 onUpload，状态/错误由调用方管理。
 */
interface PaperUploadBarProps {
  uploading: boolean;
  onUpload: (file: File) => void;
}

export function PaperUploadBar({ uploading, onUpload }: PaperUploadBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="shrink-0 border-b border-line bg-paper-warm/40 px-4 py-2 flex items-center gap-2">
      <p className="flex-1 text-xs text-ink-faint">
        未获取到 PDF 全文，可上传本地 PDF 补全，并自动升级为全文级分析
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn-secondary text-xs !py-1 shrink-0 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileUp className="w-3 h-3" />}
        {uploading ? "上传中…" : "上传 PDF"}
      </button>
    </div>
  );
}
