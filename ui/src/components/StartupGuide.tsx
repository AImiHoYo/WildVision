import { useState } from 'react';
import { AlertCircle, FolderOpen } from 'lucide-react';
import { BrandIcon } from './ui/BrandIcon';

type Props = {
  message: string;
  selectedPath: string;
  hasError: boolean;
  busy: boolean;
  onChoose: (remember: boolean) => void;
};

export function StartupGuide({ message, selectedPath, hasError, busy, onChoose }: Props) {
  const [remember, setRemember] = useState(true);
  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-studio p-6 text-ink" aria-labelledby="startup-title">
      <section className="my-auto w-full max-w-xl rounded-2xl border border-line bg-panel p-8 shadow-sm">
        <BrandIcon size={56} className="mb-5 rounded-xl" />
        <h1 id="startup-title" className="text-xl font-semibold">选择软件所在文件夹</h1>
        <p className="mt-3 text-sm leading-6 text-mute">请先找到下载后解压的 WildVision 软件文件夹。<strong className="text-ink">进入样本库后，再导入你的数据集。</strong></p>
        <div className="my-5 rounded-xl border border-line bg-studio p-4 text-sm leading-6">
          <p>例如：<span className="font-mono">WildVision-v1.1.3-macOS-arm64</span>，Windows 版选择对应的 <span className="font-mono">Windows-x64</span> 文件夹。</p>
          <p className="mt-2">打开所选文件夹后，应当能直接看到 <strong>WildVision.app</strong> 或 <strong>WildVision.exe</strong>。</p>
          <p className="mt-2 font-medium text-ink">这里先选软件文件夹，不是“我的数据集”这类数据集文件夹，也不是 datasets 子文件夹。</p>
        </div>
        <div role={hasError ? 'alert' : 'status'} aria-live="polite" className={`mb-4 rounded-lg p-3 text-sm leading-6 ${hasError ? 'border border-red-300 bg-red-50 text-red-800' : 'bg-studio text-mute'}`}>
          {hasError && <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertCircle size={16} aria-hidden />暂时无法使用这个文件夹</p>}
          {selectedPath && <p className="mb-1 break-all"><strong>你选择的是：</strong>{selectedPath}</p>}
          <p>{message}</p>
        </div>
        <label className="mb-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={busy} />
          记住软件位置，下次自动打开
        </label>
        <button type="button" disabled={busy} onClick={() => onChoose(remember)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-mark px-4 text-sm font-semibold text-white disabled:opacity-60">
          <FolderOpen size={17} aria-hidden />
          {busy ? '正在选择…' : hasError ? '重新选择软件文件夹' : '选择软件文件夹'}
        </button>
        <p className="mt-4 text-xs leading-5 text-mute">数据会保存在软件文件夹中的 datasets，自动保存和日志在 runtime。原有数据不会自动搬动或删除。</p>
      </section>
    </main>
  );
}
