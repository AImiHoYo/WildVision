import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MinusSquare,
  Search,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import { VideoFirstFrame480p } from "./VideoFirstFrame480p";

export type FilterableVideoItem = {
  video_id: string;
  video_name: string;
  fps?: number;
  status?: string;
  segment_count?: number;
};

type Props<T extends FilterableVideoItem> = {
  allSpecies: string[];
  speciesToCardsMap: Map<string, T[]>;
  totalVideos: number;
  selectedVideoIdSet: Set<string>;
  onChangeSelectedVideoIdSet: (
    updater: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  buildVideoPreviewUrl: (card: T) => string;
  isSyntheticSample?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showResetButton?: boolean;
  onResetAll?: () => void;
  popoverWidthClassName?: string;
  renderFooterActions?: (close: () => void) => ReactNode;
};

const POPOVER_VIDEO_PAGE_SIZE = 6;

export function SpeciesVideoFilterPopover<T extends FilterableVideoItem>({
  allSpecies,
  speciesToCardsMap,
  totalVideos,
  selectedVideoIdSet,
  onChangeSelectedVideoIdSet,
  buildVideoPreviewUrl,
  isSyntheticSample = false,
  open,
  onOpenChange,
  showResetButton = false,
  onResetAll,
  popoverWidthClassName = "left-0 top-[calc(100%+6px)] w-[min(780px,calc(100vw-3rem))]",
  renderFooterActions,
}: Props<T>) {
  const [activeSpecies, setActiveSpecies] = useState<string>(
    () => allSpecies[0] || "",
  );
  const [speciesSearchText, setSpeciesSearchText] = useState<string>("");
  const [videoSearchText, setVideoSearchText] = useState<string>("");
  const [videoPage, setVideoPage] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeSpecies && allSpecies.length > 0) {
      setActiveSpecies(allSpecies[0]);
    } else if (activeSpecies && !speciesToCardsMap.has(activeSpecies)) {
      setActiveSpecies(allSpecies[0] || "");
    }
  }, [allSpecies, activeSpecies, speciesToCardsMap]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  const speciesSelectionStats = useMemo(() => {
    let activeSpeciesCount = 0;
    const list = allSpecies.map((sp) => {
      const cards = speciesToCardsMap.get(sp) || [];
      let selectedCount = 0;
      for (let i = 0; i < cards.length; i += 1) {
        if (selectedVideoIdSet.has(cards[i].video_id)) selectedCount += 1;
      }
      if (selectedCount > 0) activeSpeciesCount += 1;
      return {
        species: sp,
        selectedCount,
        totalCount: cards.length,
        allSelected: cards.length > 0 && selectedCount === cards.length,
        partialSelected: selectedCount > 0 && selectedCount < cards.length,
      };
    });
    return { list, activeSpeciesCount };
  }, [allSpecies, speciesToCardsMap, selectedVideoIdSet]);

  const filteredPopoverSpecies = useMemo(() => {
    const needle = speciesSearchText.trim().toLowerCase();
    if (!needle) return speciesSelectionStats.list;
    return speciesSelectionStats.list.filter((item) =>
      item.species.toLowerCase().includes(needle),
    );
  }, [speciesSelectionStats.list, speciesSearchText]);

  const activeSpeciesCards = useMemo(() => {
    if (!activeSpecies) return [];
    const base = speciesToCardsMap.get(activeSpecies) || [];
    const needle = videoSearchText.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(
      (c) =>
        c.video_id.toLowerCase().includes(needle) ||
        c.video_name.toLowerCase().includes(needle),
    );
  }, [activeSpecies, speciesToCardsMap, videoSearchText]);

  const videoTotalPages = Math.max(
    1,
    Math.ceil(activeSpeciesCards.length / POPOVER_VIDEO_PAGE_SIZE),
  );
  const safeVideoPage = Math.min(videoTotalPages, Math.max(1, videoPage));
  const pagedPopoverVideos = useMemo(() => {
    const start = (safeVideoPage - 1) * POPOVER_VIDEO_PAGE_SIZE;
    return activeSpeciesCards.slice(start, start + POPOVER_VIDEO_PAGE_SIZE);
  }, [activeSpeciesCards, safeVideoPage]);

  const toggleSpeciesFilter = (species: string) => {
    const cardsOfSpecies = speciesToCardsMap.get(species) || [];
    if (cardsOfSpecies.length === 0) return;
    onChangeSelectedVideoIdSet((prev) => {
      const next = new Set(prev);
      let allChecked = true;
      for (let i = 0; i < cardsOfSpecies.length; i += 1) {
        if (!next.has(cardsOfSpecies[i].video_id)) {
          allChecked = false;
          break;
        }
      }
      if (allChecked) {
        for (let i = 0; i < cardsOfSpecies.length; i += 1) {
          next.delete(cardsOfSpecies[i].video_id);
        }
      } else {
        for (let i = 0; i < cardsOfSpecies.length; i += 1) {
          next.add(cardsOfSpecies[i].video_id);
        }
      }
      return next;
    });
  };

  const setSpeciesFilterChecked = (species: string, checked: boolean) => {
    const cardsOfSpecies = speciesToCardsMap.get(species) || [];
    onChangeSelectedVideoIdSet((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < cardsOfSpecies.length; i += 1) {
        if (checked) next.add(cardsOfSpecies[i].video_id);
        else next.delete(cardsOfSpecies[i].video_id);
      }
      return next;
    });
  };

  const toggleIndividualVideo = (videoId: string) => {
    onChangeSelectedVideoIdSet((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const selectAllVideos = () => {
    if (onResetAll) {
      onResetAll();
      return;
    }
    const allIds = new Set<string>();
    for (const cards of speciesToCardsMap.values()) {
      for (let i = 0; i < cards.length; i += 1) {
        allIds.add(cards[i].video_id);
      }
    }
    onChangeSelectedVideoIdSet(allIds);
  };

  const isFiltered = selectedVideoIdSet.size < totalVideos;

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all duration-200 active:scale-[0.96] ${
          open || isFiltered
            ? "border-mark bg-selection text-mark shadow-xs"
            : "border-line bg-studio text-ink hover:border-mark/40 hover:bg-card"
        }`}
        title="点击按动物物种或个别视频进行筛选"
      >
        <SlidersHorizontal size={12} className="text-mark" />
        <span>
          已选 <b className="font-mono text-mark">{selectedVideoIdSet.size}</b>/
          {totalVideos} 视频 ·{" "}
          <b className="font-mono text-ink">
            {speciesSelectionStats.activeSpeciesCount}
          </b>
          /{allSpecies.length} 物种
        </span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {showResetButton && isFiltered && (
        <button
          type="button"
          onClick={selectAllVideos}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-studio px-2 text-[11px] text-mute transition-colors hover:bg-card hover:text-ink"
        >
          <X size={11} />
          <span>重置筛选</span>
        </button>
      )}

      {open && (
        <div
          className={`absolute z-40 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl ring-1 ring-black/10 ${popoverWidthClassName}`}
        >
          <div className="grid h-[340px] grid-cols-12 divide-x divide-line">
            {/* 左栏：动物物种列表 */}
            <div className="col-span-4 flex min-h-0 flex-col bg-studio/50">
              <div className="border-b border-line p-2.5">
                <div className="relative flex h-7 items-center rounded-lg border border-line bg-panel px-2">
                  <Search size={12} className="shrink-0 text-mute" />
                  <input
                    value={speciesSearchText}
                    onChange={(e) => setSpeciesSearchText(e.target.value)}
                    placeholder={`搜索物种 (${allSpecies.length})...`}
                    className="ml-1.5 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-mute"
                  />
                  {speciesSearchText && (
                    <button
                      type="button"
                      onClick={() => setSpeciesSearchText("")}
                      className="text-mute hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-mute">
                    动物物种 ({filteredPopoverSpecies.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllVideos}
                      className="font-medium text-mark hover:underline"
                    >
                      全选
                    </button>
                    <span className="text-line">|</span>
                    <button
                      type="button"
                      onClick={() => onChangeSelectedVideoIdSet(new Set())}
                      className="text-mute hover:text-ink"
                    >
                      清空
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {filteredPopoverSpecies.length === 0 ? (
                  <div className="py-8 text-center text-xs text-mute">
                    无匹配物种
                  </div>
                ) : (
                  filteredPopoverSpecies.map((item) => {
                    const isFocused = activeSpecies === item.species;
                    return (
                      <div
                        key={item.species}
                        onClick={() => {
                          const sel = window.getSelection()?.toString().trim();
                          if (sel) return;
                          setActiveSpecies(item.species);
                          setVideoPage(1);
                          setVideoSearchText("");
                        }}
                        className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                          isFocused
                            ? "bg-selection font-semibold text-mark"
                            : "text-ink hover:bg-card"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSpeciesFilter(item.species);
                            }}
                            className="select-none text-mark hover:scale-105"
                            title={`勾选或取消「${item.species}」的全部视频`}
                          >
                            {item.allSelected ? (
                              <CheckSquare size={14} />
                            ) : item.partialSelected ? (
                              <MinusSquare size={14} />
                            ) : (
                              <Square size={14} className="text-mute" />
                            )}
                          </button>
                          <span className="selectable-text truncate select-text">{item.species}</span>
                        </div>
                        <span className="select-none ml-2 shrink-0 rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-mute">
                          {item.selectedCount}/{item.totalCount}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 右栏：对应物种下的视频卡片 */}
            <div className="col-span-8 flex min-h-0 flex-col bg-panel">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">
                    {activeSpecies
                      ? `${activeSpecies} · 视频列表`
                      : "视频列表"}
                  </span>
                  <span className="rounded bg-studio px-1.5 py-0.5 font-mono text-[10px] text-mute">
                    共 {activeSpeciesCards.length} 个视频
                  </span>
                  {activeSpecies && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSpeciesFilterChecked(activeSpecies, true)}
                        className="rounded border border-line bg-studio px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-card"
                      >
                        全选该物种
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpeciesFilterChecked(activeSpecies, false)}
                        className="rounded border border-line bg-studio px-2 py-0.5 text-[11px] text-mute hover:bg-card hover:text-ink"
                      >
                        取消全选
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex h-6 w-36 items-center rounded-md border border-line bg-studio px-2">
                    <Search size={11} className="text-mute" />
                    <input
                      value={videoSearchText}
                      onChange={(e) => {
                        setVideoSearchText(e.target.value);
                        setVideoPage(1);
                      }}
                      placeholder="搜索视频编号..."
                      className="ml-1 min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-mute"
                    />
                    {videoSearchText && (
                      <button
                        type="button"
                        onClick={() => setVideoSearchText("")}
                        className="text-mute hover:text-ink"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>

                  {videoTotalPages > 1 && (
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      <button
                        type="button"
                        disabled={safeVideoPage <= 1}
                        onClick={() => setVideoPage((p) => Math.max(1, p - 1))}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-line bg-studio text-ink disabled:opacity-40"
                      >
                        <ChevronLeft size={11} />
                      </button>
                      <span className="text-mute">
                        {safeVideoPage}/{videoTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={safeVideoPage >= videoTotalPages}
                        onClick={() =>
                          setVideoPage((p) => Math.min(videoTotalPages, p + 1))
                        }
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-line bg-studio text-ink disabled:opacity-40"
                      >
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {pagedPopoverVideos.length === 0 ? (
                  <div className="grid h-full place-items-center text-xs text-mute">
                    未找到匹配的视频
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5">
                    {pagedPopoverVideos.map((card) => {
                      const checked = selectedVideoIdSet.has(card.video_id);
                      const previewUrl = buildVideoPreviewUrl(card);
                      return (
                        <div
                          key={card.video_id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const sel = window.getSelection()?.toString().trim();
                            if (sel) return;
                            toggleIndividualVideo(card.video_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleIndividualVideo(card.video_id);
                            }
                          }}
                          className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 active:scale-[0.98] ${
                            checked
                              ? "border-mark bg-studio/70 shadow-xs ring-1 ring-mark/30"
                              : "border-line bg-studio/30 opacity-75 hover:opacity-100"
                          }`}
                        >
                          <div className="relative w-full">
                            <VideoFirstFrame480p
                              videoUrl={previewUrl}
                              videoId={card.video_id}
                              species={activeSpecies}
                              fps={card.fps || 25}
                              isSyntheticSample={isSyntheticSample}
                            />
                            <span
                              className={`select-none absolute left-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md shadow-xs backdrop-blur-xs ${
                                checked
                                  ? "bg-mark text-white"
                                  : "bg-black/55 text-white/80"
                              }`}
                            >
                              {checked ? (
                                <CheckSquare size={12} />
                              ) : (
                                <Square size={12} />
                              )}
                            </span>
                          </div>

                          <div className="flex flex-col gap-0.5 px-2.5 py-1.5">
                            <div className="flex items-center justify-between gap-1">
                              <span className="selectable-text truncate font-mono text-[11px] font-semibold text-ink select-text">
                                {card.video_id}
                              </span>
                              <span
                                className={`select-none h-1.5 w-1.5 shrink-0 rounded-full ${
                                  card.status === "completed"
                                    ? "bg-emerald-500"
                                    : card.status === "in_progress"
                                      ? "bg-mark"
                                      : "bg-mute/50"
                                }`}
                              />
                            </div>
                            <div className="select-none flex items-center justify-between font-mono text-[10px] text-mute">
                              <span>{card.segment_count || 0} 片段</span>
                              <span>{card.fps || 25}fps</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-line bg-studio/60 px-3.5 py-2 text-xs">
                <span className="font-mono text-[11px] text-mute">
                  已选 <b className="text-mark">{selectedVideoIdSet.size}</b> /{" "}
                  {totalVideos} 个视频
                </span>
                <div className="flex items-center gap-2">
                  {renderFooterActions ? (
                    renderFooterActions(() => onOpenChange(false))
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="rounded-lg bg-mark px-3 py-1 text-xs font-semibold text-white shadow-xs hover:brightness-110"
                    >
                      完成
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
