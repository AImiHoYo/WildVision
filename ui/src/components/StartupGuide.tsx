import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { BrandIcon } from './ui/BrandIcon';

type Props = {
  message: string;
  busy: boolean;
  onChoose: (remember: boolean) => void;
};

export function StartupGuide({ message, busy, onChoose }: Props) {
  const [remember, setRemember] = useState(true);
  return (
    <main className="flex h-full min-h-0 items-center justify-center bg-studio p-6 text-ink" aria-labelledby="startup-title">
      <section className="w-full max-w-xl rounded-2xl border border-line bg-panel p-8 shadow-sm">
        <BrandIcon size={56} className="mb-5 rounded-xl" />
        <h1 id="startup-title" className="text-xl font-semibold">先确定数据保存位置</h1>
        <p className="mt-3 text-sm leading-6 text-mute">请选择刚刚解压的 WildVision 文件夹。之后导入的视频和标注会保存在里面的 <strong className="text-ink">datasets</strong>，自动保存和日志会保存在 <strong className="text-ink">runtime</strong>。</p>
        <div className="my-5 rounded-xl border border-line bg-studio p-4 text-sm leading-6">
          <p>选择包含 <strong>WildVision.app</strong> 或 <strong>WildVision.exe</strong> 的外层文件夹。</p>
          <p className="mt-1 text-mute">不需要移动 App，也不需要打开终端。不要选择 datasets 子文件夹或 App 内部。</p>
        </div>
        <p role="status" aria-live="polite" className="mb-4 text-sm leading-6 text-mute">{message}</p>
        <label className="mb-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={busy} />
          记住这个位置，下次自动打开
        </label>
        <button type="button" disabled={busy} onClick={() => onChoose(remember)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-mark px-4 text-sm font-semibold text-white disabled:opacity-60">
          <FolderOpen size={17} aria-hidden />
          {busy ? '正在选择…' : '选择 WildVision 文件夹'}
        </button>
        <p className="mt-4 text-xs leading-5 text-mute">如果文件夹移动、删除或无法写入，软件会再次引导你选择。原有数据不会自动搬动或删除。</p>
      </section>
    </main>
  );
}
