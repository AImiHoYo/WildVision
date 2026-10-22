"""Portable location selection. Preferences store a path hint, never user datasets."""
from __future__ import annotations
import json
from pathlib import Path
import sys
import tempfile
from storage import atomic_write_text

_selected_root: Path | None = None


def application_data_root() -> Path:
    if _selected_root is not None:
        return _selected_root
    if not getattr(sys, 'frozen', False):
        return Path(__file__).resolve().parents[1]
    executable = Path(sys.executable).resolve()
    if sys.platform == 'darwin':
        if 'AppTranslocation' in executable.parts:
            raise OSError('请选择解压后的 WildVision 文件夹，以确定数据保存位置。')
        for parent in executable.parents:
            if parent.suffix == '.app':
                return parent.parent
        raise OSError('请选择包含 WildVision.app 的解压文件夹。')
    return executable.parent


def current_version() -> str:
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    path = root / 'build-info.json' if getattr(sys, 'frozen', False) else root / 'ui/package.json'
    try:
        return str(json.loads(path.read_text(encoding='utf-8'))['version'])
    except (OSError, ValueError, KeyError):
        return ''


def ensure_writable(root: Path) -> None:
    root = root.resolve()
    if 'AppTranslocation' in root.parts or any(p.suffix == '.app' for p in (root, *root.parents)):
        raise OSError('请选择解压文件夹本身，不要选择 App 内部或临时隔离目录。')
    try:
        datasets = root / 'datasets'
        datasets.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(prefix='.wildvision-write-check-', dir=datasets):
            pass
        runtime = root / 'runtime'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(prefix='.wildvision-write-check-', dir=runtime):
            pass
    except OSError as exc:
        raise OSError('这个文件夹无法保存数据。请将整个 WildVision 文件夹放到有写入权限的位置，再重新选择。') from exc


def validate_selected_root(folder: Path) -> Path:
    root = folder.expanduser().resolve()
    app = root / ('WildVision.app' if sys.platform == 'darwin' else 'WildVision.exe')
    if not root.is_dir() or not app.exists():
        raise OSError('这里没有找到 WildVision 程序。请选择软件 ZIP 解压后的文件夹；你的数据集请进入样本库后再导入。')
    try:
        build = json.loads((root / 'BUILD.json').read_text(encoding='utf-8-sig'))
    except (OSError, ValueError) as exc:
        raise OSError('这个文件夹中的软件文件不完整，请重新解压当前版本的 WildVision ZIP 后重试。') from exc
    if build.get('layout') != 'portable':
        raise OSError('请选择便携版 ZIP 解压后的文件夹。')
    version = current_version()
    if not version or build.get('version') != version:
        raise OSError('请选择当前版本 ZIP 解压后的文件夹；旧版数据可稍后复制到新目录。')
    ensure_writable(root)
    return root


def use_selected_root(root: Path) -> None:
    global _selected_root
    _selected_root = root.resolve()


def preference_path() -> Path:
    return Path.home() / '.wildvision' / 'startup-location.json'


def remembered_root() -> Path | None:
    try:
        value = json.loads(preference_path().read_text(encoding='utf-8'))
        if value.get('version') != current_version() or not isinstance(value.get('folder'), str):
            return None
        return validate_selected_root(Path(value['folder']))
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def remember_root(root: Path, remember: bool) -> str:
    try:
        if not remember and not preference_path().exists():
            return ''
        # A disabled choice replaces the hint without touching any old data.
        atomic_write_text(preference_path(), json.dumps({'version': current_version(), 'folder': str(root) if remember else None}, ensure_ascii=False) + '\n')
        return ''
    except OSError:
        return '本次已使用所选文件夹，但未能记住位置，下次可能需要重新选择。'
