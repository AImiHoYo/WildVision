import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  Filter,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SpeciesVideoFilterPopover } from "../ui/SpeciesVideoFilterPopover";
import {
  actionColorVars,
  getActionColor,
  type ApiResult,
  type DesktopState,
} from "../../types";
import {
  MAX_ROSE_SECTORS,
  SAMPLE_REFERENCE_CARDS,
  buildSelectionSignature,
  buildVirtualCards,
  computeInsightsSnapshot,
  formatTimeHMS,
  getCardSpeciesSet,
  type HeroChartMode,
  type InsightsSnapshot,
  type VirtualCard,
} from "./insightsAnalytics";
import {
  MinimalSocraticFooter,
  NightingaleRoseSvg,
  TimelineDensitySvg,
} from "./InsightsCharts";

type Props = {
  state: DesktopState;
  mediaDuration?: number;
  isActive?: boolean;
  onCall: (name: string, ...args: unknown[]) => Promise<ApiResult | undefined> | void;
  onSeek: (time: number, play?: boolean) => void;
};

export function EvaluatePanels({
  state,
  mediaDuration = 12,
  isActive = true,
}: Props) {
  const lastRealCardsRef = useRef<VirtualCard[] | null>(null);
  const realCards = useMemo(() => {
    if (!isActive && lastRealCardsRef.current !== null) {
      return lastRealCardsRef.current;
    }
    const next = buildVirtualCards(state, mediaDuration);
    lastRealCardsRef.current = next;
    return next;
  }, [
    isActive,
    state.dataset_items,
    state.active_card_id,
    state.segments,
    state.labels,
    state.video_id,
    state.video_name,
    state.fps,
    mediaDuration,
  ]);

  const totalRealSegments = useMemo(
    () => realCards.reduce((sum, c) => sum + c.segments.length, 0),
    [realCards],
  );

  const [useSampleData, setUseSampleData] = useState<boolean>(
    () => totalRealSegments === 0,
  );
  const autoSwitchedToRealRef = useRef(false);
  useEffect(() => {
    if (totalRealSegments > 0 && !autoSwitchedToRealRef.current) {
      autoSwitchedToRealRef.current = true;
      setUseSampleData(false);
    }
  }, [totalRealSegments]);

  const sourceCards = useSampleData ? SAMPLE_REFERENCE_CARDS : realCards;

  const { allSpecies, speciesToCardsMap } = useMemo(() => {
    const map = new Map<string, VirtualCard[]>();
    for (let i = 0; i < sourceCards.length; i += 1) {
      const card = sourceCards[i];
      const spSet = getCardSpeciesSet(card);
      for (const sp of spSet) {
        let list = map.get(sp);
        if (!list) {
          list = [];
          map.set(sp, list);
        }
        list.push(card);
      }
    }
    return {
      allSpecies: Array.from(map.keys()),
      speciesToCardsMap: map,
    };
  }, [sourceCards]);

  const [selectedVideoIdSet, setSelectedVideoIdSet] = useState<Set<string>>(
    () => new Set(sourceCards.map((c) => c.video_id)),
  );
  const [popoverOpen, setPopoverOpen] = useState<boolean>(false);
  const [actionSearchText, setActionSearchText] = useState<string>("");

  const [stats, setStats] = useState<InsightsSnapshot>(() =>
    computeInsightsSnapshot(sourceCards),
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>(() =>
    formatTimeHMS(new Date()),
  );
  const [committedSignature, setCommittedSignature] = useState<string>(() =>
    buildSelectionSignature(useSampleData, sourceCards),
  );

  const prevSourceKeyRef = useRef<string>(
    `${useSampleData ? "sample" : "real"}:${sourceCards.length}:${sourceCards[0]?.video_id || ""}`,
  );
  useEffect(() => {
    const sourceKey = `${useSampleData ? "sample" : "real"}:${sourceCards.length}:${sourceCards[0]?.video_id || ""}`;
    if (prevSourceKeyRef.current !== sourceKey) {
      prevSourceKeyRef.current = sourceKey;
      const allIds = new Set<string>();
      for (let i = 0; i < sourceCards.length; i += 1) {
        allIds.add(sourceCards[i].video_id);
      }
      setSelectedVideoIdSet(allIds);
    }
  }, [useSampleData, sourceCards]);

  const draftFilteredCards = useMemo(() => {
    const res: VirtualCard[] = [];
    for (let i = 0; i < sourceCards.length; i += 1) {
      if (selectedVideoIdSet.has(sourceCards[i].video_id)) {
        res.push(sourceCards[i]);
      }
    }
    return res;
  }, [sourceCards, selectedVideoIdSet]);

  const draftSignature = useMemo(
    () => buildSelectionSignature(useSampleData, draftFilteredCards),
    [useSampleData, draftFilteredCards],
  );

  const hasPendingChanges = draftSignature !== committedSignature;

  const handleManualUpdateCharts = useCallback(() => {
    const nextSnapshot = computeInsightsSnapshot(draftFilteredCards);
    setStats(nextSnapshot);
    setCommittedSignature(draftSignature);
    setLastUpdatedAt(formatTimeHMS(new Date()));
    setPopoverOpen(false);
  }, [draftFilteredCards, draftSignature]);

  const [heroMode, setHeroMode] = useState<HeroChartMode>("rose");
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

  const buildVideoPreviewUrl = useCallback(
    (card: VirtualCard): string => {
      const base = state.media_base_url || "";
      if (!base || card.isSample) return "";
      return `${base}/video?rel=${encodeURIComponent(card.video_relpath)}&id=${encodeURIComponent(card.video_id)}&fallback=0`;
    },
    [state.media_base_url],
  );

  const visibleActionStats = useMemo(() => {
    const needle = actionSearchText.trim().toLowerCase();
    if (!needle) return stats.actionStats;
    return stats.actionStats.filter((item) =>
      item.action.toLowerCase().includes(needle),
    );
  }, [stats.actionStats, actionSearchText]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-studio px-6 py-3.5 text-ink">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-1 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-12">
          {/* ==================== LEFT COLUMN (7 Cols) ==================== */}
          <div className="flex min-h-0 flex-col gap-3.5 lg:col-span-7">
            {/* ==================== 【左上】筛选 ==================== */}
            <section className="relative shrink-0 rounded-2xl border border-line bg-panel px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
                    <Filter size={14} className="text-mark" />
                    <h2>筛选</h2>
                  </div>

                  <SpeciesVideoFilterPopover
                    allSpecies={allSpecies}
                    speciesToCardsMap={speciesToCardsMap}
                    totalVideos={sourceCards.length}
                    selectedVideoIdSet={selectedVideoIdSet}
                    onChangeSelectedVideoIdSet={setSelectedVideoIdSet}
                    buildVideoPreviewUrl={buildVideoPreviewUrl}
                    isSyntheticSample={useSampleData}
                    open={popoverOpen}
                    onOpenChange={setPopoverOpen}
                    popoverWidthClassName="left-0 top-[calc(100%+10px)] w-[min(780px,calc(100vw-3rem))]"
                    renderFooterActions={(close) => (
                      <>
                        <button
                          type="button"
                          onClick={close}
                          className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-mute hover:text-ink"
                        >
                          收起面板
                        </button>
                        <button
                          type="button"
                          onClick={handleManualUpdateCharts}
                          className="inline-flex items-center gap-1 rounded-lg bg-mark px-3 py-1 text-xs font-semibold text-white shadow-xs hover:brightness-110"
                        >
                          <RefreshCw size={11} />
                          <span>应用并更新图表</span>
                        </button>
                      </>
                    )}
                  />

                  <div className="hidden items-center gap-1.5 text-[11px] text-mute xl:flex">
                    <span>·</span>
                    <span>
                      片段{" "}
                      <b className="font-mono text-mark">{stats.totalSegments}</b>{" "}
                      <span className="font-mono">
                        ({stats.totalDurationSec.toFixed(1)}s)
                      </span>
                    </span>
                    <span>·</span>
                    <span>
                      中位{" "}
                      <b className="font-mono text-ink">
                        {stats.medianDur.toFixed(2)}s
                      </b>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-studio px-2 font-mono text-[11px] text-mute"
                    title="点击「更新图表」后才会根据最新筛选条件重新计算图表"
                  >
                    <Clock size={11} className="text-mark" />
                    <span>上次更新 {lastUpdatedAt}</span>
                  </span>

                  <button
                    type="button"
                    onClick={handleManualUpdateCharts}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all duration-200 active:scale-[0.96] ${
                      hasPendingChanges
                        ? "bg-mark text-white shadow-sm ring-2 ring-mark/25 hover:brightness-110"
                        : "border border-line bg-studio text-ink hover:border-mark/50 hover:bg-card"
                    }`}
                    title="点击手动更新行为洞察图表"
                  >
                    <RefreshCw
                      size={12}
                      className={hasPendingChanges ? "animate-spin" : ""}
                      style={
                        hasPendingChanges ? { animationDuration: "3s" } : undefined
                      }
                    />
                    <span>更新图表</span>
                    {hasPendingChanges && (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setUseSampleData((v) => !v)}
                    className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-all duration-200 active:scale-[0.96] ${
                      useSampleData
                        ? "badge-warn"
                        : "border-line bg-studio text-mute hover:bg-card hover:text-ink"
                    }`}
                    title="切换内置演示样本与当前项目数据"
                  >
                    <Sparkles size={11} />
                    <span>{useSampleData ? "演示样本" : "当前项目"}</span>
                  </button>
                </div>
              </div>
            </section>

            {/* ==================== 【左下】物种行为时间分布 ==================== */}
            <section className="flex min-h-0 flex-1 flex-col justify-between rounded-2xl border border-line bg-panel p-4">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold tracking-tight text-ink">
                      物种行为时间分布
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-md bg-studio px-2 py-0.5 font-mono text-[11px] text-mute">
                      <Layers size={11} className="text-mark" />
                      <span>
                        {stats.speciesNames.length} 物种 · {stats.actionStats.length} 类行为
                      </span>
                    </span>
                  </div>

                  <SegmentedControl
                    label="图表类型"
                    fullWidth={false}
                    value={heroMode}
                    onChange={setHeroMode}
                    options={[
                      { id: "rose", label: "极坐标玫瑰图" },
                      { id: "mosaic", label: "矩阵面积图" },
                    ]}
                  />
                </div>

                {heroMode === "rose" ? (
                  <div className="grid min-h-0 flex-1 grid-cols-1 items-center gap-4 overflow-hidden rounded-xl border border-line bg-studio p-4 sm:grid-cols-12">
                    <div className="flex h-full flex-col items-center justify-center sm:col-span-5">
                      <NightingaleRoseSvg
                        items={stats.rosePlotItems}
                        orderedActions={stats.orderedActions}
                        hoveredAction={hoveredAction}
                        onHoverAction={setHoveredAction}
                      />
                      {stats.actionStats.length > MAX_ROSE_SECTORS && (
                        <span className="mt-1 font-mono text-[10px] text-mute">
                          展示前 {MAX_ROSE_SECTORS - 1} 项主要行为及其他
                        </span>
                      )}
                    </div>

                    <div className="flex h-full min-h-0 flex-col sm:col-span-7">
                      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-mute">
                          行为时长与频次明细 ({visibleActionStats.length})
                        </span>
                        {stats.actionStats.length > 5 && (
                          <div className="relative flex h-6 w-36 items-center rounded-md border border-line bg-panel px-2">
                            <Search size={11} className="text-mute" />
                            <input
                              value={actionSearchText}
                              onChange={(e) => setActionSearchText(e.target.value)}
                              placeholder="搜索行为名称..."
                              className="ml-1 min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-mute"
                            />
                            {actionSearchText && (
                              <button
                                type="button"
                                onClick={() => setActionSearchText("")}
                                className="text-mute hover:text-ink"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                        {visibleActionStats.length === 0 ? (
                          <div className="grid h-full place-items-center text-xs text-mute">
                            暂无匹配的行为数据
                          </div>
                        ) : (
                          visibleActionStats.map((item) => {
                            const color = getActionColor(
                              item.action,
                              stats.orderedActions,
                            );
                            const isHovered = hoveredAction === item.action;
                            return (
                              <div
                                key={item.action}
                                onMouseEnter={() => setHoveredAction(item.action)}
                                onMouseLeave={() => setHoveredAction(null)}
                                className={`group flex items-center gap-2.5 rounded-lg border bg-panel px-3 py-1.5 text-xs transition-all duration-150 ${
                                  isHovered
                                    ? "border-mark/60 shadow-xs"
                                    : "border-line/80 hover:border-mark/35"
                                }`}
                              >
                                <span
                                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition-transform ${
                                    isHovered ? "scale-125" : ""
                                  }`}
                                  style={{ backgroundColor: color.bg }}
                                />
                                <span
                                  className="w-24 shrink-0 truncate font-semibold text-ink"
                                  title={item.action}
                                >
                                  {item.action}
                                </span>

                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${Math.max(3, item.durationPct)}%`,
                                      backgroundColor: color.bg,
                                    }}
                                  />
                                </div>

                                <span className="w-16 shrink-0 text-right font-mono text-[10px] text-mute">
                                  {item.count}段·均{item.avgDur.toFixed(1)}s
                                </span>

                                <span className="w-20 shrink-0 text-right font-mono text-[11px] font-bold text-ink">
                                  {item.duration.toFixed(1)}s ({item.durationPct.toFixed(0)}%)
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 overflow-hidden">
                    <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto rounded-xl border border-line bg-studio p-2">
                      {stats.mosaicColumns.length === 0 ? (
                        <div className="grid flex-1 place-items-center text-xs text-mute">
                          暂无物种行为数据
                        </div>
                      ) : (
                        stats.mosaicColumns.map((col) => {
                          const colWeight =
                            stats.mosaicTotalDur > 0
                              ? Math.max(
                                  16,
                                  (col.totalDuration / stats.mosaicTotalDur) * 100,
                                )
                              : 100 / stats.mosaicColumns.length;
                          return (
                            <div
                              key={col.species}
                              style={{ flex: `${colWeight} 1 0%` }}
                              className="flex h-full min-w-[115px] flex-col overflow-hidden rounded-lg border border-line/70 bg-panel"
                            >
                              <div className="flex shrink-0 items-center justify-between border-b border-line px-2.5 py-1.5">
                                <span
                                  className="truncate text-xs font-semibold text-ink"
                                  title={col.species}
                                >
                                  {col.species}
                                </span>
                                <span className="ml-1 shrink-0 font-mono text-[10px] text-mute">
                                  {col.totalDuration.toFixed(1)}s
                                </span>
                              </div>

                              <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
                                {col.blocks.map((block) => {
                                  const color = getActionColor(
                                    block.action,
                                    stats.orderedActions,
                                  );
                                  const heightWeight = Math.max(14, block.sharePct);
                                  return (
                                    <div
                                      key={block.action}
                                      style={{
                                        flex: `${heightWeight} 1 0%`,
                                        backgroundColor:
                                          block.duration > 0 ? color.bg : undefined,
                                      }}
                                      title={`${col.species} · ${block.action}: ${block.duration.toFixed(2)}s (${block.sharePct.toFixed(1)}%) · ${block.count}段`}
                                      className={`flex min-h-[24px] flex-col justify-between overflow-hidden rounded-md px-2 py-1 ${
                                        block.duration > 0
                                          ? "text-white shadow-xs"
                                          : "border border-dashed border-line bg-studio text-mute"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="truncate text-[11px] font-semibold">
                                          {block.action}
                                        </span>
                                        <span className="shrink-0 font-mono text-[11px] font-bold">
                                          {block.sharePct.toFixed(0)}%
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <MinimalSocraticFooter
                chartUsage={
                  heroMode === "rose"
                    ? "极坐标玫瑰图用于对比各行为类别在时间预算与出现频次上的分布结构。"
                    : "矩阵面积图按物种时长权重切分列宽，对比跨物种的行为时间占比差异。"
                }
                questions={[
                  {
                    tag: "类别失衡与 Macro-F1",
                    question:
                      "当单一行为占据绝大多数时长而稀有行为样本极少时，直接用标准 Cross-Entropy 训练分类模型，Accuracy 与 Macro-F1 会出现怎样的背离？",
                  },
                  {
                    tag: "跨物种同名动作",
                    question:
                      "不同物种（如爬行类与禽类）共享相同行为标签但运动形态迥异，模型应直接做扁平分类还是融合每个物种的先验特征？",
                  },
                  {
                    tag: "短动作滑窗偏差",
                    question:
                      "对出现频次高但单次极短的动作，按固定时间步长滑窗切分训练片段会导致正负样本发生什么失衡？",
                  },
                ]}
              />
            </section>
          </div>

          {/* ==================== RIGHT COLUMN (5 Cols, Locked Height) ==================== */}
          <div className="flex min-h-0 flex-col gap-3.5 lg:col-span-5">
            {/* ==================== 【右上】行为持续时长分布 ==================== */}
            <section className="flex min-h-0 flex-1 flex-col justify-between rounded-2xl border border-line bg-panel p-4">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-ink">
                    行为持续时长分布
                  </h2>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="rounded bg-studio px-2 py-0.5 text-ink">
                      {stats.minDur.toFixed(1)} ~ {stats.maxDur.toFixed(1)}s
                    </span>
                    <span className="rounded bg-studio px-2 py-0.5 font-semibold text-mark">
                      均值 {stats.meanDur.toFixed(1)}s
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 grid min-h-0 flex-1 grid-cols-12 items-stretch gap-3">
                  <div className="col-span-5 grid grid-cols-4 items-end gap-2 rounded-xl border border-line/70 bg-studio p-2.5">
                    {stats.buckets.map((b) => (
                      <div
                        key={b.id}
                        className="group flex h-full flex-col items-center justify-end"
                        title={`${b.label} (${b.sub}): ${b.count}段 (${b.pct.toFixed(1)}%)`}
                      >
                        <span className="mb-1 font-mono text-[9px] font-semibold text-ink">
                          {b.pct.toFixed(0)}%
                        </span>
                        <div className="flex w-full flex-1 items-end rounded bg-card/70">
                          <div
                            className="w-full rounded bg-indigo-500 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:brightness-110"
                            style={{
                              height: `${b.count > 0 ? Math.max(12, b.pct) : 0}%`,
                            }}
                          />
                        </div>
                        <span className="mt-1 truncate font-mono text-[9px] text-mute">
                          {b.label.replace("s", "")}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="col-span-7 flex min-h-0 flex-col rounded-xl border border-line/70 bg-studio p-2.5">
                    <div className="mb-1.5 flex shrink-0 items-center justify-between text-[10px] text-mute">
                      <span>
                        各行为时长范围 ({stats.perActionIntervals.length}项)
                      </span>
                      <span className="font-mono">
                        0s ~ {Math.max(6, Math.ceil(stats.maxDur))}s
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                      {stats.perActionIntervals.map((item) => {
                        const scaleMax = Math.max(6, stats.maxDur * 1.1);
                        const low = Math.max(0, item.mean - item.std);
                        const high = Math.min(scaleMax, item.mean + item.std);
                        const leftPct = (low / scaleMax) * 100;
                        const widthPct = Math.max(4, ((high - low) / scaleMax) * 100);
                        const meanPct = Math.min(98, (item.mean / scaleMax) * 100);
                        const color = getActionColor(
                          item.action,
                          stats.orderedActions,
                        );
                        const isHovered = hoveredAction === item.action;

                        return (
                          <div
                            key={item.action}
                            onMouseEnter={() => setHoveredAction(item.action)}
                            onMouseLeave={() => setHoveredAction(null)}
                            className={`grid grid-cols-[68px_1fr_62px] items-center gap-1.5 rounded px-1 py-0.5 text-[11px] transition-colors ${
                              isHovered ? "bg-panel" : ""
                            }`}
                          >
                            <span
                              className="truncate font-medium text-ink"
                              title={item.action}
                            >
                              {item.action}
                            </span>
                            <div className="relative h-3.5 rounded bg-card">
                              <div
                                className="absolute top-1/2 h-0.5 -translate-y-1/2 opacity-40"
                                style={{
                                  left: `${(item.min / scaleMax) * 100}%`,
                                  width: `${Math.max(2, ((item.max - item.min) / scaleMax) * 100)}%`,
                                  backgroundColor: color.bg,
                                }}
                              />
                              <div
                                className="action-pill absolute bottom-0.5 top-0.5 rounded"
                                style={{
                                  ...actionColorVars(color),
                                  left: `${leftPct}%`,
                                  width: `${widthPct}%`,
                                }}
                              />
                              <div
                                className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full"
                                style={{
                                  left: `${meanPct}%`,
                                  backgroundColor: color.bg,
                                }}
                              />
                            </div>
                            <span className="text-right font-mono text-[10px] text-mute">
                              {item.mean.toFixed(1)}±{item.std.toFixed(1)}s
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <MinimalSocraticFooter
                chartUsage="时长图谱用于分析各行为持续时间的长度跨度、中心趋势与边界离散程度。"
                questions={[
                  {
                    tag: "帧采样步长设计",
                    question:
                      "模型固定输入 16 帧时，单一固定采样间隔对 <1s 短动作和 >6s 长动作分别会造成什么信息损失？",
                  },
                  {
                    tag: "候选窗口剪枝",
                    question:
                      "根据绝大多数行为落入的时长区间，应如何设计或剪枝时序定位模型的二维时间网格与先验窗口尺度？",
                  },
                ]}
              />
            </section>

            {/* ==================== 【右下】时序活跃度与并发占比 ==================== */}
            <section className="flex min-h-0 flex-1 flex-col justify-between rounded-2xl border border-line bg-panel p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-ink">
                    时序活跃度与并发占比
                  </h2>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="badge-success rounded px-2 py-0.5">
                      有效占比 {stats.foregroundRatio.toFixed(0)}%
                    </span>
                    <span className="badge-warn rounded px-2 py-0.5">
                      多轨并发 {stats.overlapRatio.toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 rounded-xl border border-line/70 bg-studio p-3">
                  <TimelineDensitySvg bins={stats.densityBins} />
                  <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line/60 pt-2 text-[11px]">
                    <div>
                      <div className="flex justify-between text-mute">
                        <span>有效行为占比</span>
                        <span className="font-mono font-semibold text-ink">
                          {stats.foregroundRatio.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-card">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${stats.foregroundRatio}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-mute">
                        <span>多轨并发率</span>
                        <span className="font-mono font-semibold text-ink">
                          {stats.overlapRatio.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-card">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-500"
                          style={{ width: `${stats.overlapRatio}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <MinimalSocraticFooter
                chartUsage="时序密度图用于分析有效行为在视频时间轴上的分布位置、前景稀疏度与多目标并发特征。"
                questions={[
                  {
                    tag: "背景稀疏性裁剪",
                    question:
                      "当无动作背景占比较高时，时序定位模型在训练阶段正负样本会如何失衡？可通过怎样的数据增强策略缓解？",
                  },
                  {
                    tag: "模糊边界与多轨并发",
                    question:
                      "当同一时刻多只动物并发不同动作或起止边界存在分歧时，绝对硬边界标签（One-hot）有何局限？",
                  },
                ]}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
