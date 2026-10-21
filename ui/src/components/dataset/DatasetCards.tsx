import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileJson,
  Filter,
  FolderOpen,
  Grid,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { SegmentedControl } from "../ui/SegmentedControl";
import { BrandIcon } from "../ui/BrandIcon";
import { SpeciesVideoFilterPopover } from "../ui/SpeciesVideoFilterPopover";
import { actionColorVars, getActionColor, type DatasetCardItem, type DatasetWorkspaceOption } from "../../types";
type Props = {
  datasetName: string;
  workspaceDir: string;
  mediaBaseUrl?: string;
  availableDatasets?: DatasetWorkspaceOption[];
  items: DatasetCardItem[];
  activeCardId: string | null;
  onSwitchDataset?: (folderName: string) => void;
  onImportZip: () => void;
  onOpenFolder: () => void;
  onAddSingleVideo: () => void;
  onLoadDemoDataset: () => void;
  onOpenCard: (videoId: string) => void;
  onExportSelected: (videoIds: string[], mode: "zip" | "merged_json") => void;
  onRemoveSelected: (videoIds: string[]) => void;
};

type GridPreset = "auto" | "2x1" | "2x2" | "3x2" | "3x3" | "4x3";

function summarizeAnimals(listAnimal: string[] = []): { species: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of listAnimal) {
    const clean = (name || "").trim();
    if (!clean) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([species, count]) => ({ species, count }));
}

function summarizeActions(pairs: [string, string][] = []): string[] {
  const seen: string[] = [];
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair[1] && !seen.includes(pair[1])) {
      seen.push(pair[1]);
    }
  }
  return seen;
}

function getCardSpeciesList(item: DatasetCardItem): string[] {
  const seen = new Set<string>();
  for (const sp of item.list_animal || []) {
    const clean = (sp || "").trim();
    if (clean) seen.add(clean);
  }
  for (const pair of item.list_animal_action || []) {
    if (Array.isArray(pair) && pair[0]) {
      const clean = pair[0].trim();
      if (clean) seen.add(clean);
    }
  }
  return Array.from(seen);
}

function matchesSearchNeedle(item: DatasetCardItem, needle: string): boolean {
  if (!needle) return true;
  if (item.video_id && item.video_id.toLowerCase().includes(needle)) return true;
  if (item.video_name && item.video_name.toLowerCase().includes(needle)) return true;
  if (item.video_relpath && item.video_relpath.toLowerCase().includes(needle)) return true;
  if (item.list_animal) {
    for (const sp of item.list_animal) {
      if (sp && sp.toLowerCase().includes(needle)) return true;
    }
  }
  if (item.list_animal_action) {
    for (const pair of item.list_animal_action) {
      if (
        Array.isArray(pair) &&
        ((pair[0] && pair[0].toLowerCase().includes(needle)) ||
          (pair[1] && pair[1].toLowerCase().includes(needle)))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function DatasetCards({
  datasetName,
  mediaBaseUrl = "",
  availableDatasets = [],
  items,
  activeCardId,
  onSwitchDataset,
  onImportZip,
  onOpenFolder,
  onAddSingleVideo,
  onLoadDemoDataset,
  onOpenCard,
  onExportSelected,
  onRemoveSelected,
}: Props) {
  const [filter, setFilter] = useState<"all" | "unstarted" | "in_progress" | "completed">("all");
  const [searchText, setSearchText] = useState("");
  const deferredSearchText = useDeferredValue(searchText);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [datasetSwitcherOpen, setDatasetSwitcherOpen] = useState(false);
  const datasetSwitcherRef = useRef<HTMLDivElement>(null);
  const [gridPreset, setGridPreset] = useState<GridPreset>("auto");
  const [autoGrid, setAutoGrid] = useState<{ cols: number; rows: number }>({ cols: 3, rows: 2 });
  const [page, setPage] = useState(1);
  const [jumpPageInput, setJumpPageInput] = useState("");

  // Popover Filter State (Unified with Behavior Insights)
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [filteredVideoIdSet, setFilteredVideoIdSet] = useState<Set<string>>(
    () => new Set(items.map((it) => it.video_id)),
  );

  const menuRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Single-pass O(N) metrics + species-to-cards mapping for 100,000+ items
  const datasetMetrics = useMemo(() => {
    const speciesMap = new Map<string, DatasetCardItem[]>();
    let unstarted = 0;
    let in_progress = 0;
    let completed = 0;
    let totalSegments = 0;
    let totalPairs = 0;
    let donePairs = 0;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.status === "completed") completed += 1;
      else if (item.status === "in_progress") in_progress += 1;
      else unstarted += 1;

      totalSegments += item.segment_count || 0;
      totalPairs += item.label_count || 0;
      donePairs += item.done_count || 0;

      const spList = getCardSpeciesList(item);
      for (let j = 0; j < spList.length; j += 1) {
        const sp = spList[j];
        let list = speciesMap.get(sp);
        if (!list) {
          list = [];
          speciesMap.set(sp, list);
        }
        list.push(item);
      }
    }

    const allSpecies = Array.from(speciesMap.keys());
    const all = items.length;
    const completedVideoPct = all > 0 ? (completed / all) * 100 : 0;
    const inProgressVideoPct = all > 0 ? (in_progress / all) * 100 : 0;
    const overallLabelPct =
      totalPairs > 0 ? Math.min(100, Math.round((donePairs / totalPairs) * 100)) : 0;

    return {
      counts: { all, unstarted, in_progress, completed },
      totalSegments,
      totalPairs,
      donePairs,
      completedVideoPct,
      inProgressVideoPct,
      overallLabelPct,
      allSpecies,
      speciesToCardsMap: speciesMap,
    };
  }, [items]);

  const {
    counts,
    totalSegments,
    totalPairs,
    donePairs,
    completedVideoPct,
    inProgressVideoPct,
    overallLabelPct,
    allSpecies,
    speciesToCardsMap,
  } = datasetMetrics;

  // Keep filteredVideoIdSet synced when dataset items are loaded or replaced
  const prevDatasetSignatureRef = useRef<string>("");
  useEffect(() => {
    const sig = `${items.length}:${items[0]?.video_id || ""}:${items[items.length - 1]?.video_id || ""}`;
    if (prevDatasetSignatureRef.current !== sig) {
      prevDatasetSignatureRef.current = sig;
      const allIds = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        allIds.add(items[i].video_id);
      }
      setFilteredVideoIdSet(allIds);
    }
  }, [items]);

  const resetAllFilterVideos = useCallback(() => {
    const allIds = new Set<string>();
    for (let i = 0; i < items.length; i += 1) {
      allIds.add(items[i].video_id);
    }
    setFilteredVideoIdSet(allIds);
  }, [items]);
  const buildVideoPreviewUrl = useCallback(
    (card: DatasetCardItem): string => {
      if (!mediaBaseUrl) return "";
      const rel = card.video_relpath || `videos/${card.video_name || `${card.video_id}.mp4`}`;
      return `${mediaBaseUrl}/video?rel=${encodeURIComponent(rel)}&id=${encodeURIComponent(card.video_id)}&fallback=0`;
    },
    [mediaBaseUrl],
  );

  // O(1) Set for batch export selection lookups
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedIds((prev) => (prev.length > 0 ? [] : prev));
      setSelectionMode(false);
      setAddMenuOpen(false);
      return;
    }
    setSelectedIds((prev) => {
      if (prev.length === 0) return prev;
      const valid = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        valid.add(items[i].video_id);
      }
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [items]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!datasetSwitcherOpen) return;
    const onDown = (event: MouseEvent) => {
      if (
        datasetSwitcherRef.current &&
        !datasetSwitcherRef.current.contains(event.target as Node)
      ) {
        setDatasetSwitcherOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [datasetSwitcherOpen]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      if (w < 100 || h < 100) return;
      const cols = Math.max(1, Math.min(5, Math.floor((w + 14) / 330)));
      const rows = Math.max(1, Math.min(4, Math.floor((h + 14) / 195)));
      setAutoGrid((prev) =>
        prev.cols === cols && prev.rows === rows ? prev : { cols, rows },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length === 0, selectionMode]);

  const isAllVideosFilteredIn = filteredVideoIdSet.size === items.length;

  const visibleItems = useMemo(() => {
    const needle = deferredSearchText.trim().toLowerCase();
    if (filter === "all" && isAllVideosFilteredIn && !needle) {
      return items;
    }
    const result: DatasetCardItem[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!isAllVideosFilteredIn && !filteredVideoIdSet.has(item.video_id)) {
        continue;
      }
      if (filter !== "all" && item.status !== filter) continue;
      if (needle && !matchesSearchNeedle(item, needle)) continue;
      result.push(item);
    }
    return result;
  }, [items, filter, isAllVideosFilteredIn, filteredVideoIdSet, deferredSearchText]);

  const activeGrid = useMemo(() => {
    if (gridPreset === "auto") return autoGrid;
    const [c, r] = gridPreset.split("x").map(Number);
    return { cols: c || 3, rows: r || 2 };
  }, [gridPreset, autoGrid]);

  const pageSize = Math.max(1, activeGrid.cols * activeGrid.rows);
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, page));

  useEffect(() => {
    setPage(1);
  }, [filter, filteredVideoIdSet, deferredSearchText, gridPreset]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return visibleItems.slice(start, start + pageSize);
  }, [visibleItems, safePage, pageSize]);

  const toggleSelect = (videoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return Array.from(next);
    });
  };

  const allVisibleSelected = useMemo(() => {
    if (visibleItems.length === 0 || selectedIdSet.size < visibleItems.length) {
      return false;
    }
    for (let i = 0; i < visibleItems.length; i += 1) {
      if (!selectedIdSet.has(visibleItems[i].video_id)) return false;
    }
    return true;
  }, [visibleItems, selectedIdSet]);

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      const removeSet = new Set<string>();
      for (let i = 0; i < visibleItems.length; i += 1) {
        removeSet.add(visibleItems[i].video_id);
      }
      setSelectedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      const merged = new Set(selectedIds);
      for (let i = 0; i < visibleItems.length; i += 1) {
        merged.add(visibleItems[i].video_id);
      }
      setSelectedIds(Array.from(merged));
    }
  };

  const selectCompletedOnly = () => {
    const res: string[] = [];
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].status === "completed") res.push(items[i].video_id);
    }
    setSelectedIds(res);
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds([]);
      return next;
    });
  };

  const handleJumpPage = () => {
    const num = Number.parseInt(jumpPageInput.trim(), 10);
    if (!Number.isNaN(num) && num >= 1) {
      setPage(Math.min(totalPages, Math.max(1, num)));
      setJumpPageInput("");
    }
  };

  if (items.length === 0) {
    return (
      <div className="drop-grid grid flex-1 place-items-center p-6">
        <div className="w-full max-w-xl">
          <div className="rounded-2xl border border-line bg-panel p-8 shadow-sm">
            <div className="flex items-start gap-4">
              <BrandIcon size={56} className="rounded-xl" />
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold tracking-tight text-ink">
                  导入数据集
                </h1>
                <p className="mt-0.5 text-xs text-mute">
                  选择或拖入 .zip 压缩包，自动解压至 datasets 目录
                </p>
              </div>
            </div>

            <div
              onClick={onImportZip}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onImportZip();
                }
              }}
              className="group mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-studio/70 px-6 py-6 text-center transition-all duration-200 hover:border-mark hover:bg-selection/50 active:scale-[0.99]"
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-panel text-mute shadow-sm ring-1 ring-line transition-colors group-hover:text-mark">
                <Archive size={17} />
              </div>
              <p className="mt-2 text-xs font-semibold text-ink">
                点击或拖入数据集压缩包 (.zip)
              </p>
            </div>

            {availableDatasets.length > 0 && (
              <div className="mt-4 rounded-xl border border-line bg-studio/60 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">已有数据集</span>
                  <span className="font-mono text-[11px] text-mute">
                    共 {availableDatasets.length} 个
                  </span>
                </div>
                <div className="space-y-1.5">
                  {availableDatasets.map((ds) => (
                    <button
                      key={ds.folder_name}
                      type="button"
                      onClick={() => onSwitchDataset?.(ds.folder_name)}
                      className="flex w-full items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-left text-xs transition-colors hover:border-mark hover:bg-selection/50"
                    >
                      <span className="flex items-center gap-2 font-mono font-semibold text-ink">
                        <FolderOpen size={13} className="text-mark" />
                        {ds.folder_name}
                      </span>
                      <span className="font-mono text-[11px] text-mute">
                        {ds.video_count} 个视频
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-mark px-3.5 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:brightness-110 active:scale-[0.96]"
                  onClick={onImportZip}
                >
                  <Archive size={13} />
                  导入压缩包
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-medium text-ink transition-all duration-200 hover:bg-card active:scale-[0.96]"
                  onClick={onOpenFolder}
                >
                  <FolderOpen size={13} className="text-mute" />
                  导入文件夹
                </button>
              </div>

              <button
                type="button"
                className="badge-progress inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.96]"
                onClick={onLoadDemoDataset}
              >
                <Sparkles size={13} />
                示例数据
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio">
      {/* Clean Top Toolbar & Full-Width Progress Strip */}
      <div className="shrink-0 border-b border-line bg-panel">
        <div className="px-6 pb-3 pt-3">
          {/* Row 1: Clickable Dataset Switcher + Search + Status Segmented Control + Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div ref={datasetSwitcherRef} className="relative">
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  const sel = window.getSelection()?.toString().trim();
                  if (sel) return;
                  setDatasetSwitcherOpen((prev) => !prev);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDatasetSwitcherOpen((prev) => !prev);
                  }
                }}
                className={`inline-flex h-8 max-w-[380px] cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-left transition-all duration-200 active:scale-[0.98] ${
                  datasetSwitcherOpen
                    ? "border-mark bg-selection text-mark shadow-xs"
                    : "border-line bg-studio/80 text-ink hover:border-mark/50 hover:bg-card"
                }`}
                title="点击切换数据集"
              >
                <FolderOpen size={14} className="select-none shrink-0 text-mark" />
                <span className="selectable-text truncate font-mono text-[13px] font-semibold tracking-tight select-text">
                  {datasetName || "选择数据集"}
                </span>
                <ChevronDown
                  size={13}
                  className={`select-none shrink-0 text-mute transition-transform duration-200 ${
                    datasetSwitcherOpen ? "rotate-180 text-mark" : ""
                  }`}
                />
              </div>

              {datasetSwitcherOpen && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[min(380px,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl ring-1 ring-black/10">
                  <div className="flex items-center justify-between border-b border-line bg-studio/60 px-3.5 py-2 text-xs">
                    <span className="font-semibold text-ink">切换数据集</span>
                    <span className="font-mono text-[11px] text-mute">
                      共 {availableDatasets.length} 个
                    </span>
                  </div>

                  <div className="max-h-64 space-y-1 overflow-y-auto p-2">
                    {availableDatasets.length === 0 ? (
                      <div className="py-5 text-center text-xs text-mute">
                        暂无其他数据集
                      </div>
                    ) : (
                      availableDatasets.map((ds) => {
                        const isCurrent =
                          ds.folder_name === datasetName ||
                          ds.dataset_name === datasetName;
                        return (
                          <button
                            key={ds.folder_name}
                            type="button"
                            onClick={() => {
                              setDatasetSwitcherOpen(false);
                              if (!isCurrent) {
                                onSwitchDataset?.(ds.folder_name);
                              }
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                              isCurrent
                                ? "bg-selection font-semibold text-mark ring-1 ring-mark/30"
                                : "text-ink hover:bg-card"
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <FolderOpen
                                size={14}
                                className={
                                  isCurrent ? "shrink-0 text-mark" : "shrink-0 text-mute"
                                }
                              />
                              <span className="truncate font-mono text-xs font-semibold">
                                {ds.folder_name}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="font-mono text-[11px] text-mute">
                                {ds.video_count} 个视频
                              </span>
                              {isCurrent && (
                                <CheckCircle2 size={14} className="text-mark" />
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-line bg-studio/50 px-3 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setDatasetSwitcherOpen(false);
                        onImportZip();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-mark px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110"
                    >
                      <Archive size={12} />
                      <span>导入压缩包</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDatasetSwitcherOpen(false);
                        onOpenFolder();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink hover:bg-card"
                    >
                      <FolderOpen size={12} className="text-mute" />
                      <span>导入文件夹</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex h-8 w-48 items-center rounded-lg border border-line bg-studio px-2.5 transition-colors focus-within:border-mark focus-within:bg-panel sm:w-56">
                <Search size={13} className="shrink-0 text-mute" />
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索编号、物种或行为..."
                  className="ml-1.5 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-mute"
                />
                {searchText && (
                  <button
                    type="button"
                    className="text-mute hover:text-ink"
                    onClick={() => setSearchText("")}
                    aria-label="清除搜索"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="hidden sm:block">
                <SegmentedControl
                  label="状态筛选"
                  fullWidth={false}
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { id: "all", label: `全部 ${counts.all}` },
                    { id: "unstarted", label: `未开始 ${counts.unstarted}` },
                    { id: "in_progress", label: `进行中 ${counts.in_progress}` },
                    { id: "completed", label: `已完成 ${counts.completed}` },
                  ]}
                />
              </div>

              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  title="导入或添加视频"
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-mark px-2.5 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:brightness-110 active:scale-[0.96]"
                  onClick={() => setAddMenuOpen((prev) => !prev)}
                >
                  <Plus size={14} />
                  <span className="hidden sm:inline">导入</span>
                </button>

                {addMenuOpen && (
                  <div className="absolute right-0 top-9 z-40 w-48 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-ink transition-colors hover:bg-card"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onImportZip();
                      }}
                    >
                      <Archive size={14} className="text-mark" />
                      导入压缩包
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-ink transition-colors hover:bg-card"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onAddSingleVideo();
                      }}
                    >
                      <Video size={14} className="text-mark" />
                      添加单个视频
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-ink transition-colors hover:bg-card"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onOpenFolder();
                      }}
                    >
                      <FolderOpen size={14} className="text-mute" />
                      导入文件夹
                    </button>
                    <button
                      type="button"
                      className="mt-0.5 flex w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-left text-xs font-medium text-mute transition-colors hover:bg-card hover:text-ink"
                      onClick={() => {
                        setAddMenuOpen(false);
                        onLoadDemoDataset();
                      }}
                    >
                      <Sparkles size={14} className="text-mark" />
                      示例数据
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                title={selectionMode ? "退出批量选择" : "批量选择与导出"}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-all duration-200 active:scale-[0.96] ${
                  selectionMode
                    ? "border-mark bg-selection text-mark"
                    : "border-line bg-panel text-ink hover:bg-card"
                }`}
                onClick={toggleSelectionMode}
              >
                <MoreHorizontal size={15} />
                {selectionMode && <span>批量选择</span>}
              </button>
            </div>
          </div>

          {/* Row 2: Sleek Full-Width Overall Progress Bar */}
          <div className="mt-2.5 flex items-center gap-3">
            <div className="flex shrink-0 items-center gap-2.5 text-[11px] text-mute">
              <span className="font-medium text-ink">总进度</span>
              <span className="font-mono">
                {counts.completed}/{counts.all} 视频
              </span>
              <span className="text-line">·</span>
              <span className="font-mono">
                {donePairs}/{totalPairs} 行为
              </span>
              <span className="text-line">·</span>
              <span className="font-mono">{totalSegments} 片段</span>
            </div>
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-card">
              <div
                className="h-full bg-emerald-500 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ width: `${Math.max(completedVideoPct, overallLabelPct)}%` }}
              />
              {inProgressVideoPct > 0 && (
                <div
                  className="h-full bg-mark/70 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: `${inProgressVideoPct}%` }}
                />
              )}
            </div>
            <span className="shrink-0 font-mono text-xs font-bold text-mark">
              {overallLabelPct}%
            </span>
          </div>
          {/* Row 3: Unified Popover Species & Video Filter + Grid Preset Switcher */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="relative flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                <Filter size={13} className="text-mark" />
                <span>筛选</span>
              </span>

              <SpeciesVideoFilterPopover
                allSpecies={allSpecies}
                speciesToCardsMap={speciesToCardsMap}
                totalVideos={items.length}
                selectedVideoIdSet={filteredVideoIdSet}
                onChangeSelectedVideoIdSet={setFilteredVideoIdSet}
                buildVideoPreviewUrl={buildVideoPreviewUrl}
                open={filterPopoverOpen}
                onOpenChange={setFilterPopoverOpen}
                showResetButton
                onResetAll={resetAllFilterVideos}
                renderFooterActions={(close) => (
                  <>
                    <button
                      type="button"
                      onClick={resetAllFilterVideos}
                      className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-mute hover:text-ink"
                    >
                      恢复全部
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      className="inline-flex items-center gap-1 rounded-lg bg-mark px-3 py-1 text-xs font-semibold text-white shadow-xs hover:brightness-110"
                    >
                      <span>完成</span>
                    </button>
                  </>
                )}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Grid size={12} className="text-mute" />
              <SegmentedControl
                label="卡片网格排列"
                fullWidth={false}
                size="xs"
                value={gridPreset}
                onChange={setGridPreset}
                options={[
                  { id: "auto", label: "自适应" },
                  { id: "2x1", label: "2×1" },
                  { id: "2x2", label: "2×2" },
                  { id: "3x2", label: "3×2" },
                  { id: "3x3", label: "3×3" },
                  { id: "4x3", label: "4×3" },
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Batch Selection Bar */}
      {selectionMode && (
        <div className="shrink-0 border-b border-mark/30 bg-selection px-6 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 font-medium text-ink transition-all hover:bg-card active:scale-[0.96]"
                onClick={toggleSelectAllVisible}
              >
                {allVisibleSelected ? (
                  <CheckSquare size={13} className="text-mark" />
                ) : (
                  <Square size={13} />
                )}
                {allVisibleSelected ? "取消全选" : "全选当前筛选"}
              </button>
              <button
                type="button"
                className="rounded-md border border-line bg-panel px-2.5 py-1 font-medium text-ink transition-all hover:bg-card active:scale-[0.96]"
                onClick={selectCompletedOnly}
              >
                仅选已完成 ({counts.completed})
              </button>
              <span className="font-mono font-semibold text-mark">
                已选 {selectedIds.length} 项
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={selectedIds.length === 0}
                className="inline-flex items-center gap-1 rounded-md bg-mark px-3 py-1 font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.96] disabled:opacity-40"
                onClick={() => onExportSelected(selectedIds, "zip")}
              >
                <Download size={13} />
                导出 (.zip)
              </button>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 font-semibold text-mark transition-all hover:bg-card active:scale-[0.96] disabled:opacity-40"
                onClick={() => onExportSelected(selectedIds, "merged_json")}
              >
                <FileJson size={13} />
                合并 JSON
              </button>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 font-medium text-rose-500 transition-all hover:bg-rose-500/20 active:scale-[0.96] disabled:opacity-40"
                onClick={() => {
                  onRemoveSelected(selectedIds);
                  setSelectedIds([]);
                }}
              >
                <Trash2 size={13} />
                移除
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-mute transition-all hover:text-ink active:scale-[0.96]"
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds([]);
                }}
              >
                <X size={13} />
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Dynamic X * Y Cards Viewport */}
      <div
        ref={stageRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      >
        {pagedItems.length === 0 ? (
          <div className="grid h-full place-items-center rounded-xl border border-dashed border-line text-xs text-mute">
            未找到匹配的视频样本
          </div>
        ) : (
          <div
            className="grid gap-3.5"
            style={{
              gridTemplateColumns: `repeat(${activeGrid.cols}, minmax(0, 1fr))`,
            }}
          >
            {pagedItems.map((item, idx) => {
              const globalIdx = (safePage - 1) * pageSize + idx;
              const checked = selectedIdSet.has(item.video_id);
              const isCurrent = activeCardId === item.video_id;
              const pct =
                item.label_count > 0
                  ? Math.min(100, Math.round((item.done_count / item.label_count) * 100))
                  : 0;
              const speciesSummary = summarizeAnimals(item.list_animal);
              const actionsSummary = summarizeActions(item.list_animal_action);
              const matched = item.video_matched !== false;
              const trackCount = (item.list_animal || []).length || 1;

              return (
                <div
                  key={item.video_id}
                  onClick={() => {
                    const sel = window.getSelection()?.toString().trim();
                    if (sel) return;
                    if (selectionMode) {
                      toggleSelect(item.video_id);
                    } else {
                      onOpenCard(item.video_id);
                    }
                  }}
                  className={`group relative flex cursor-pointer flex-col justify-between rounded-xl border bg-panel p-4 transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-mark/50 hover:shadow-md active:scale-[0.99] ${
                    selectionMode && checked
                      ? "border-mark bg-selection ring-2 ring-mark/20"
                      : isCurrent
                        ? "border-mark/70 shadow-sm"
                        : "border-line"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {selectionMode && (
                          <span className="select-none text-mark">
                            {checked ? (
                              <CheckSquare size={15} />
                            ) : (
                              <Square size={15} className="text-mute" />
                            )}
                          </span>
                        )}
                        <span className="select-none font-mono text-[11px] text-mute">
                          #{String(globalIdx + 1).padStart(2, "0")}
                        </span>
                        <span className="select-none text-mute/40">·</span>
                        <span className="selectable-text truncate font-mono text-xs font-semibold text-ink select-text">
                          {item.video_id}
                        </span>
                        {matched ? (
                          <span
                            className="select-none inline-flex shrink-0 items-center text-emerald-500"
                            title="编号与视频文件已对齐"
                          >
                            <CheckCircle2 size={13} />
                          </span>
                        ) : (
                          <span
                            className="badge-warn select-none inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                            title="编号与视频文件名不一致"
                          >
                            <AlertTriangle size={10} />
                            未对齐
                          </span>
                        )}
                      </div>

                      <StatusBadge
                        status={item.status}
                        done={item.done_count}
                        total={item.label_count}
                      />
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between gap-2">
                      <h2
                        className="selectable-text truncate text-[14px] font-semibold tracking-tight text-ink transition-colors duration-200 group-hover:text-mark select-text"
                        title={item.video_name}
                      >
                        {item.video_name}
                      </h2>
                      <span className="select-none shrink-0 font-mono text-[11px] text-mute">
                        {item.fps || 25} fps · {trackCount} 轨
                      </span>
                    </div>

                    {(speciesSummary.length > 0 || actionsSummary.length > 0) && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3">
                        {speciesSummary.map(({ species, count }) => (
                          <span
                            key={species}
                            className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-0.5 text-[11px] font-medium text-ink"
                          >
                            <span className="selectable-text select-text">{species}</span>
                            <span className="select-none font-mono text-[10px] font-semibold text-mute">
                              ×{count}
                            </span>
                          </span>
                        ))}
                        {actionsSummary.map((act) => {
                          const color = getActionColor(act, actionsSummary);
                          return (
                            <span
                              key={act}
                              className="action-pill selectable-text inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium select-text"
                              style={actionColorVars(color)}
                            >
                              <span
                                className="select-none h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: color.bg }}
                              />
                              <span className="selectable-text select-text">{act}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-card">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          item.status === "completed" ? "bg-emerald-500" : "bg-mark"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-mute">
                        {item.done_count}/{item.label_count} 行为 · {item.segment_count} 片段
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium text-mute transition-colors group-hover:text-mark">
                        {selectionMode ? (
                          <span className={checked ? "font-semibold text-mark" : ""}>
                            {checked ? "已选" : "选择"}
                          </span>
                        ) : (
                          <>
                            <span>打开</span>
                            <ArrowRight
                              size={12}
                              className="transition-transform duration-200 group-hover:translate-x-0.5"
                            />
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Pagination Footer */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-6 py-2.5 text-xs">
        <span className="font-mono text-[11px] text-mute">
          显示 {visibleItems.length > 0 ? (safePage - 1) * pageSize + 1 : 0}–
          {Math.min(visibleItems.length, safePage * pageSize)} / 共 {visibleItems.length} 项
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-studio px-2 text-[11px] font-medium text-ink transition-all duration-200 hover:bg-card active:scale-[0.96] disabled:opacity-40"
          >
            <ChevronLeft size={13} />
            <span>上一页</span>
          </button>

          <div className="flex items-center gap-1 px-1 font-mono text-[11px]">
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pageNum = i + 1;
              if (totalPages > 7 && safePage > 4) {
                pageNum = Math.min(totalPages - 6 + i, safePage - 3 + i);
              }
              const active = pageNum === safePage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setPage(pageNum)}
                  className={`h-7 min-w-[28px] rounded-md px-1.5 font-medium transition-all duration-200 active:scale-[0.94] ${
                    active
                      ? "bg-mark text-white shadow-sm"
                      : "text-mute hover:bg-card hover:text-ink"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-studio px-2 text-[11px] font-medium text-ink transition-all duration-200 hover:bg-card active:scale-[0.96] disabled:opacity-40"
          >
            <span>下一页</span>
            <ChevronRight size={13} />
          </button>

          <span className="ml-1 font-mono text-[11px] text-mute">
            {safePage} / {totalPages} 页
          </span>

          {totalPages > 7 && (
            <div className="ml-1 inline-flex items-center gap-1 font-mono text-[11px]">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpPageInput}
                onChange={(e) => setJumpPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJumpPage();
                }}
                placeholder="页码"
                className="h-7 w-14 rounded-md border border-line bg-studio px-1.5 text-center text-[11px] text-ink outline-none focus:border-mark"
              />
              <button
                type="button"
                onClick={handleJumpPage}
                className="h-7 rounded-md border border-line bg-studio px-2 text-[11px] font-medium text-ink transition-colors hover:bg-card"
              >
                跳转
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function StatusBadge({
  status,
  done,
  total,
}: {
  status: string;
  done: number;
  total: number;
}) {
  if (status === "completed") {
    return (
      <span className="badge-success inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-medium">
        <CheckCircle2 size={10} />
        已完成 {done}/{total}
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="badge-progress inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-medium">
        <Clock size={10} />
        进行中 {done}/{total}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-card px-2 py-0.5 font-mono text-[10px] font-medium text-mute">
      未开始 0/{total}
    </span>
  );
}
