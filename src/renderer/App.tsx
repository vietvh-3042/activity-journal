import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityKind,
  ActivitySegment,
  ClassificationRule,
  CollectorStatus,
  ExclusionRule,
  Settings,
  WeeklyStat,
} from '../shared/contracts';
import {
  colorForLabel,
  classifySegments,
  activityAppLabel,
  activityDisplayLabel,
  activityDetailKey,
  distributeByDay,
  distributeByHour,
  distributeByWeekday,
  groupActivities,
  selectionMatches,
  topStats,
  trackedSeconds,
  trackerColors,
} from './analytics';
import { formatDuration, localDayRange, todayInputValue } from './date-range';

type View = 'overview' | 'timeline' | 'search' | 'reports' | 'settings';

const defaultSettings: Settings = {
  autoStart: true,
  idleThresholdSeconds: 300,
  retentionDays: 90,
  exclusions: [],
  classificationRules: [],
};
const weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const trackZoomLevels = [24, 12, 6, 3, 1];

const kindLabels: Record<ActivityKind, string> = {
  active: 'Ứng dụng',
  browser: 'Website',
  idle: 'Không hoạt động',
  locked: 'Khóa máy',
  suspended: 'Sleep',
  paused: 'Tạm dừng',
  excluded: 'Đã ẩn',
  app_open: 'Mở app',
  app_close: 'Đóng app',
  file_hint: 'Tệp',
};

function periodRange(days: number) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - days + 1);
  const to = new Date();
  to.setHours(24, 0, 0, 0);
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

function Histogram({
  values,
  labels,
  accent = '#d8dde5',
  tooltipFor,
}: {
  values: number[];
  labels: string[];
  accent?: string;
  tooltipFor?: (value: number, index: number) => string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="histogram">
      {values.map((value, index) => (
        <div
          className="histogram-column chart-tooltip"
          data-tooltip={tooltipFor?.(value, index) ?? `${labels[index] || index} · ${formatDuration(value)}`}
          tabIndex={0}
          key={`${labels[index]}-${index}`}
        >
          <div
            className="histogram-bar"
            style={{ height: `${Math.max(value ? 7 : 1, (value / max) * 74)}%`, background: accent }}
          />
          <span>{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

function TrackerCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`tracker-card ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function DailyChart({ segments, days }: { segments: ActivitySegment[]; days: number }) {
  const shownDays = Math.min(days, 30);
  const values = distributeByDay(segments, shownDays);
  const max = Math.max(1, ...values.map((item) => item.durationSeconds));
  const labelEvery = shownDays <= 7 ? 1 : 5;
  return (
    <div className="daily-chart">
      {values.map((item, index) => (
        <div
          className="daily-column chart-tooltip"
          data-tooltip={`${item.date.split('-').reverse().join('/')} · ${formatDuration(item.durationSeconds)}`}
          tabIndex={0}
          key={item.date}
        >
          {shownDays <= 7 && (
            <span className="daily-value">
              {item.durationSeconds > 0
                ? formatDuration(item.durationSeconds).replace(' giờ ', 'h ').replace(' phút', 'm')
                : ''}
            </span>
          )}
          <div className="daily-bar-shell">
            <div
              className="daily-bar"
              style={{
                height: `${Math.max(item.durationSeconds ? 2 : 0, (item.durationSeconds / max) * 100)}%`,
                background: trackerColors[index % trackerColors.length],
              }}
            />
          </div>
          <small>
            {index % labelEvery === 0 || index === values.length - 1
              ? item.date.slice(5).replace('-', '/')
              : ''}
          </small>
        </div>
      ))}
    </div>
  );
}

function DistributionPanel({
  title,
  stats,
  category,
}: {
  title: string;
  stats: WeeklyStat[];
  category: WeeklyStat['category'];
}) {
  const items = topStats(stats, category, 12);
  const total = items.reduce((sum, item) => sum + item.durationSeconds, 0);
  const [hovered, setHovered] = useState<string>();
  let progress = 0;
  const arcs = items.map((item) => {
    const percent = total ? (item.durationSeconds / total) * 100 : 0;
    const result = { ...item, percent, offset: -progress };
    progress += percent;
    return result;
  });
  const activeItem = items.find((item) => item.label === hovered);
  return (
    <TrackerCard title={title} className="distribution-card">
      <div className="distribution-layout">
        <div className="donut">
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={`Phân bổ thời gian theo ${category === 'app' ? 'ứng dụng' : 'website'}`}
          >
            <circle className="donut-base" cx="60" cy="60" r="45" pathLength="100" />
            {arcs.map((item) => (
              <circle
                className={`donut-arc ${hovered && hovered !== item.label ? 'is-dimmed' : ''} ${hovered === item.label ? 'is-active' : ''}`}
                cx="60"
                cy="60"
                r="45"
                pathLength="100"
                fill="none"
                stroke={colorForLabel(item.label)}
                strokeDasharray={`${item.percent} ${100 - item.percent}`}
                strokeDashoffset={item.offset}
                key={item.label}
                tabIndex={0}
                onMouseEnter={() => setHovered(item.label)}
                onMouseLeave={() => setHovered(undefined)}
                onFocus={() => setHovered(item.label)}
                onBlur={() => setHovered(undefined)}
              >
                <title>
                  {item.label} · {formatDuration(item.durationSeconds)} · {item.percent.toFixed(1)}%
                </title>
              </circle>
            ))}
          </svg>
          <div>
            <strong>{activeItem ? formatDuration(activeItem.durationSeconds) : items.length}</strong>
            <span>{activeItem?.label ?? (category === 'app' ? 'apps' : 'domains')}</span>
          </div>
        </div>
        <div className="rank-list">
          {items.map((item) => (
            <div
              className={`rank-row ${hovered === item.label ? 'is-active' : ''} ${hovered && hovered !== item.label ? 'is-dimmed' : ''}`}
              key={`${category}-${item.label}`}
              tabIndex={0}
              onMouseEnter={() => setHovered(item.label)}
              onMouseLeave={() => setHovered(undefined)}
              onFocus={() => setHovered(item.label)}
              onBlur={() => setHovered(undefined)}
            >
              <span className="color-dot" style={{ background: colorForLabel(item.label) }} />
              <strong>{item.label}</strong>
              <time>{formatDuration(item.durationSeconds)}</time>
            </div>
          ))}
          {!items.length && <div className="empty-dark">Chưa có dữ liệu.</div>}
        </div>
      </div>
    </TrackerCard>
  );
}

function ActivityTrack({
  segments,
  date,
  selectedActivity,
  onSelect,
}: {
  segments: ActivitySegment[];
  date: string;
  selectedActivity?: string;
  onSelect: (key?: string) => void;
}) {
  const start = new Date(`${date}T00:00:00`).getTime();
  const end = new Date(`${date}T24:00:00`).getTime();
  const [zoomHours, setZoomHours] = useState(24);
  const [centerTime, setCenterTime] = useState((start + end) / 2);
  const lastWheelZoomAt = useRef(0);
  const trackViewportRef = useRef<HTMLDivElement>(null);
  const [dragRange, setDragRange] = useState<{ start: number; current: number }>();
  const rows = [
    {
      label: 'Activities',
      accepts: (item: ActivitySegment) => item.kind === 'active' || item.kind === 'browser',
      interactive: true,
    },
    {
      label: 'Trạng thái',
      accepts: (item: ActivitySegment) =>
        ['idle', 'locked', 'paused', 'excluded', 'suspended'].includes(item.kind),
    },
  ];
  const selectedSegments = useMemo(
    () =>
      selectedActivity
        ? segments.filter(
            (item) =>
              (item.kind === 'active' || item.kind === 'browser') && selectionMatches(item, selectedActivity),
          )
        : [],
    [segments, selectedActivity],
  );
  const selectedBounds = useMemo(
    () =>
      selectedSegments.length
        ? {
            start: Math.min(...selectedSegments.map((item) => new Date(item.startUtc).getTime())),
            end: Math.max(...selectedSegments.map((item) => new Date(item.endUtc).getTime())),
          }
        : undefined,
    [selectedSegments],
  );
  const viewDuration = Math.min(end - start, zoomHours * 60 * 60 * 1000);
  const viewStart = Math.max(start, Math.min(centerTime - viewDuration / 2, end - viewDuration));
  const viewEnd = viewStart + viewDuration;

  useEffect(() => {
    setZoomHours(24);
    setCenterTime((start + end) / 2);
  }, [date, start, end]);
  useEffect(() => {
    if (selectedBounds) setCenterTime((selectedBounds.start + selectedBounds.end) / 2);
  }, [selectedBounds]);

  const zoom = useCallback(
    (direction: 'in' | 'out', anchorRatio = 0.5) => {
      const index = trackZoomLevels.indexOf(zoomHours);
      const next =
        direction === 'in' ? Math.min(trackZoomLevels.length - 1, index + 1) : Math.max(0, index - 1);
      const nextZoomHours = trackZoomLevels[next];
      if (nextZoomHours === zoomHours) return;
      const ratio = Math.max(0, Math.min(1, anchorRatio));
      const anchorTime = viewStart + viewDuration * ratio;
      const nextDuration = Math.min(end - start, nextZoomHours * 60 * 60 * 1000);
      const nextStart = Math.max(start, Math.min(anchorTime - nextDuration * ratio, end - nextDuration));
      setCenterTime(nextStart + nextDuration / 2);
      setZoomHours(nextZoomHours);
    },
    [end, start, viewDuration, viewStart, zoomHours],
  );

  function pan(direction: -1 | 1) {
    setCenterTime((current) =>
      Math.max(
        start + viewDuration / 2,
        Math.min(end - viewDuration / 2, current + (direction * viewDuration) / 2),
      ),
    );
  }

  function focusSelection() {
    if (!selectedBounds) return;
    const requiredHours = Math.max(1, ((selectedBounds.end - selectedBounds.start) / 3_600_000) * 1.25);
    const fittingZoom = [...trackZoomLevels].reverse().find((hours) => hours >= requiredHours) ?? 24;
    setZoomHours(fittingZoom);
    setCenterTime((selectedBounds.start + selectedBounds.end) / 2);
  }

  function pointerRatio(clientX: number, element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - bounds.left - 92) / Math.max(1, bounds.width - 92)));
  }

  function finishDrag() {
    if (!dragRange) return;
    const fromRatio = Math.min(dragRange.start, dragRange.current);
    const toRatio = Math.max(dragRange.start, dragRange.current);
    setDragRange(undefined);
    if (toRatio - fromRatio < 0.015) return;
    const rangeStart = viewStart + viewDuration * fromRatio;
    const rangeEnd = viewStart + viewDuration * toRatio;
    const requiredHours = Math.max(1, ((rangeEnd - rangeStart) / 3_600_000) * 1.15);
    const fittingZoom = [...trackZoomLevels].reverse().find((hours) => hours >= requiredHours) ?? 24;
    setZoomHours(fittingZoom);
    setCenterTime((rangeStart + rangeEnd) / 2);
  }

  useEffect(() => {
    const viewport = trackViewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (Math.abs(event.deltaY) < 2) return;
      const now = performance.now();
      if (now - lastWheelZoomAt.current < 160) return;
      lastWheelZoomAt.current = now;
      const bounds = viewport.getBoundingClientRect();
      const laneLeft = bounds.left + 92;
      const laneWidth = Math.max(1, bounds.width - 92);
      zoom(event.deltaY < 0 ? 'in' : 'out', (event.clientX - laneLeft) / laneWidth);
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [zoom]);

  const formatClock = (value: number) => {
    const time = new Date(value);
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  };
  const formatTime = (value: string) => formatClock(new Date(value).getTime());
  const formatTick = (value: number) => (value === end ? '24:00' : formatClock(value));
  const zoomIndex = trackZoomLevels.indexOf(zoomHours);
  return (
    <div className="track-shell">
      <div className="track-zoom-toolbar">
        <div className="track-window-label">
          <strong>
            {formatTick(viewStart)} – {formatTick(viewEnd)}
          </strong>
          <span>
            {selectedActivity
              ? `${selectedSegments.length} block đang highlight`
              : 'Chọn Activity để zoom chi tiết'}
          </span>
        </div>
        <div className="track-zoom-actions">
          <button
            type="button"
            onClick={() => pan(-1)}
            disabled={viewStart <= start}
            aria-label="Dịch khung giờ sang trái"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => zoom('out')}
            disabled={zoomIndex === 0}
            aria-label="Thu nhỏ track"
          >
            −
          </button>
          <span>{zoomHours} giờ</span>
          <button
            type="button"
            onClick={() => zoom('in')}
            disabled={zoomIndex === trackZoomLevels.length - 1}
            aria-label="Phóng to track"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => pan(1)}
            disabled={viewEnd >= end}
            aria-label="Dịch khung giờ sang phải"
          >
            ›
          </button>
          <button
            type="button"
            className="focus-track-button"
            onClick={focusSelection}
            disabled={!selectedBounds}
          >
            Tập trung
          </button>
        </div>
      </div>
      <div className="track-minimap">
        <strong>24h</strong>
        <div
          className="minimap-lane"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - bounds.left) / bounds.width;
            setCenterTime(start + (end - start) * ratio);
          }}
        >
          {segments
            .filter((item) => item.kind === 'active' || item.kind === 'browser')
            .map((item) => {
              const left = ((new Date(item.startUtc).getTime() - start) / (end - start)) * 100;
              const width =
                ((new Date(item.endUtc).getTime() - new Date(item.startUtc).getTime()) / (end - start)) * 100;
              return (
                <i
                  key={item.id}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(0.2, width)}%`,
                    background: colorForLabel(activityAppLabel(item)),
                  }}
                />
              );
            })}
          <span
            className="minimap-window"
            style={{
              left: `${((viewStart - start) / (end - start)) * 100}%`,
              width: `${(viewDuration / (end - start)) * 100}%`,
            }}
          />
        </div>
      </div>
      <div
        className="track-viewport"
        ref={trackViewportRef}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('.time-block')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const ratio = pointerRatio(event.clientX, event.currentTarget);
          setDragRange({ start: ratio, current: ratio });
        }}
        onPointerMove={(event) => {
          if (!dragRange) return;
          const currentRatio = pointerRatio(event.clientX, event.currentTarget);
          setDragRange((current) => (current ? { ...current, current: currentRatio } : current));
        }}
        onPointerUp={finishDrag}
        onPointerCancel={() => setDragRange(undefined)}
      >
        {dragRange && (
          <div className="drag-lane-overlay">
            <span
              style={{
                left: `${Math.min(dragRange.start, dragRange.current) * 100}%`,
                width: `${Math.abs(dragRange.current - dragRange.start) * 100}%`,
              }}
            />
          </div>
        )}
        <div className="hour-axis">
          <span />
          {Array.from({ length: 13 }, (_, index) => {
            const tick = viewStart + (viewDuration / 12) * index;
            return <time key={index}>{formatTick(tick)}</time>;
          })}
        </div>
        {rows.map((row) => (
          <div className={`track-row ${row.interactive ? 'interactive-row' : ''}`} key={row.label}>
            <strong>{row.label}</strong>
            <div className="track-lane">
              {segments
                .filter(
                  (item) =>
                    row.accepts(item) &&
                    new Date(item.endUtc).getTime() > viewStart &&
                    new Date(item.startUtc).getTime() < viewEnd,
                )
                .map((item) => {
                  const left =
                    ((Math.max(viewStart, new Date(item.startUtc).getTime()) - viewStart) / viewDuration) *
                    100;
                  const right =
                    ((Math.min(viewEnd, new Date(item.endUtc).getTime()) - viewStart) / viewDuration) * 100;
                  const label = row.interactive
                    ? activityDisplayLabel(item)
                    : item.title || item.domain || item.app || kindLabels[item.kind];
                  const selectionKey = row.interactive ? activityDetailKey(item) : undefined;
                  const matches = row.interactive && selectionMatches(item, selectedActivity);
                  const className = [
                    'time-block',
                    left > 78 ? 'tooltip-right' : '',
                    selectedActivity && row.interactive ? (matches ? 'is-highlighted' : 'is-dimmed') : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <button
                      type="button"
                      className={className}
                      key={item.id}
                      data-tooltip={`${formatTime(item.startUtc)} – ${formatTime(item.endUtc)} · ${formatDuration(item.durationSeconds)} · ${label}`}
                      aria-label={`${label}, ${formatTime(item.startUtc)} đến ${formatTime(item.endUtc)}`}
                      onClick={() =>
                        selectionKey && onSelect(selectedActivity === selectionKey ? undefined : selectionKey)
                      }
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(0.35, right - left)}%`,
                        background: colorForLabel(
                          row.interactive ? activityAppLabel(item) : item.app || item.domain || label,
                        ),
                      }}
                    >
                      <span>{right - left > 5 ? label : ''}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <p className="track-selection-hint">
        Lăn chuột để zoom · Kéo trên vùng trống để chọn khoảng · Click minimap để di chuyển · Hover block để
        xem chi tiết.
      </p>
    </div>
  );
}

function GroupedActivities({
  segments,
  selectedActivity,
  onSelect,
  onEdit,
}: {
  segments: ActivitySegment[];
  selectedActivity?: string;
  onSelect: (key?: string) => void;
  onEdit: (target: ActivityEditTarget) => void;
}) {
  const groups = useMemo(() => groupActivities(segments), [segments]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!selectedActivity?.startsWith('detail:')) return;
    const parent = groups.find((group) => group.details.some((detail) => detail.key === selectedActivity));
    if (parent) setExpanded((current) => new Set(current).add(parent.key));
  }, [groups, selectedActivity]);

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!groups.length) return <div className="empty-dark">Chưa có Activity nào trong ngày này.</div>;
  const sessionCount = groups.reduce((total, group) => total + group.sessions.length, 0);
  return (
    <div className="grouped-shell">
      <div className="group-summary">
        <div>
          <strong>Tất cả Activities: {formatDuration(trackedSeconds(segments))}</strong>
          <span>
            {groups.length} ứng dụng · {sessionCount} phiên hoạt động
          </span>
        </div>
        {selectedActivity && (
          <button type="button" onClick={() => onSelect(undefined)}>
            Xóa highlight
          </button>
        )}
      </div>
      <div className="grouped-activities">
        {groups.map((group) => {
          const isExpanded = expanded.has(group.key);
          const containsSelection =
            selectedActivity === group.key || group.details.some((detail) => detail.key === selectedActivity);
          return (
            <div
              className={`activity-group ${containsSelection ? 'contains-selection' : ''}`}
              key={group.key}
            >
              <div
                className={`activity-group-row ${selectedActivity === group.key ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(selectedActivity === group.key ? undefined : group.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ')
                    onSelect(selectedActivity === group.key ? undefined : group.key);
                }}
              >
                <button
                  type="button"
                  className="expand-button"
                  aria-label={isExpanded ? `Thu gọn ${group.app}` : `Mở rộng ${group.app}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpanded(group.key);
                  }}
                >
                  {isExpanded ? '⌄' : '›'}
                </button>
                <span className="color-dot" style={{ background: colorForLabel(group.app) }} />
                <div className="group-main">
                  <strong>
                    {group.app}
                    {group.isGame && <span className="game-badge">GAME</span>}
                  </strong>
                  <small>
                    {[group.category, group.project, `${group.sessions.length} phiên đang sử dụng`]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
                <span className="group-session-label">
                  {group.details.length} {group.details.length === 1 ? 'Activity' : 'Activities'}
                </span>
                <time>{formatDuration(group.durationSeconds)}</time>
                <button
                  type="button"
                  className="edit-activity-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit({ label: group.app, sessions: group.sessions });
                  }}
                >
                  Sửa
                </button>
              </div>
              {isExpanded && (
                <div className="activity-details">
                  {group.details.map((detail) => (
                    <div
                      className={`detail-group-row ${selectedActivity === detail.key ? 'is-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      key={detail.key}
                      onClick={() => onSelect(selectedActivity === detail.key ? undefined : detail.key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ')
                          onSelect(selectedActivity === detail.key ? undefined : detail.key);
                      }}
                    >
                      <span className="detail-branch">└</span>
                      <div className="group-main">
                        <strong>{detail.label}</strong>
                        <small>
                          {[detail.category, detail.project, detail.note, detail.domain, detail.path]
                            .filter((value, index, values) => value && values.indexOf(value) === index)
                            .join(' · ') || `${detail.sessions.length} phiên foreground`}
                        </small>
                      </div>
                      <span className="group-session-label">{detail.sessions.length} phiên</span>
                      <time>{formatDuration(detail.durationSeconds)}</time>
                      <button
                        type="button"
                        className="edit-activity-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit({ label: detail.label, sessions: detail.sessions });
                        }}
                      >
                        Sửa
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityTable({ segments }: { segments: ActivitySegment[] }) {
  if (!segments.length)
    return <div className="empty-dark">Chưa có hoạt động trong khoảng thời gian này.</div>;
  return (
    <div className="activity-table">
      {segments.map((item) => {
        const label = item.title || item.domain || item.app || kindLabels[item.kind];
        return (
          <div className="activity-row" key={item.id}>
            <time>
              {new Date(item.startUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </time>
            <span
              className="color-dot"
              style={{ background: colorForLabel(item.app || item.domain || item.kind) }}
            />
            <div>
              <strong>{label}</strong>
              <small>
                {[
                  kindLabels[item.kind],
                  item.app,
                  item.domain,
                  item.path,
                  item.category,
                  item.project,
                  item.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </div>
            <b>{formatDuration(item.durationSeconds)}</b>
          </div>
        );
      })}
    </div>
  );
}

interface ActivityEditTarget {
  label: string;
  sessions: ActivitySegment[];
}

function ActivityEditor({
  target,
  onClose,
  onSaved,
}: {
  target: ActivityEditTarget;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const commonValue = (field: 'category' | 'project' | 'note') => {
    const values = new Set(target.sessions.map((item) => item[field] ?? ''));
    return values.size === 1 ? [...values][0] : '';
  };
  const [category, setCategory] = useState(() => commonValue('category'));
  const [project, setProject] = useState(() => commonValue('project'));
  const [note, setNote] = useState(() => commonValue('note'));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await window.activityJournal.annotateSegments({
        ids: target.sessions.map((item) => item.id),
        category,
        project,
        note,
      });
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="activity-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-editor-title"
      >
        <header>
          <div>
            <h2 id="activity-editor-title">Chỉnh sửa Activity</h2>
            <p>
              {target.label} · {target.sessions.length} phiên ·{' '}
              {formatDuration(target.sessions.reduce((sum, item) => sum + item.durationSeconds, 0))}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </header>
        <label>
          Category
          <input
            list="activity-categories"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Ví dụ: Công việc, Game, Học tập"
          />
        </label>
        <datalist id="activity-categories">
          <option value="Công việc" />
          <option value="Game" />
          <option value="Học tập" />
          <option value="Giải trí" />
          <option value="Giao tiếp" />
        </datalist>
        <label>
          Project
          <input
            value={project}
            onChange={(event) => setProject(event.target.value)}
            placeholder="Ví dụ: Activity Journal"
          />
        </label>
        <label>
          Ghi chú
          <textarea
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Bạn đã làm gì trong khoảng này?"
          />
        </label>
        <footer>
          <span>Thay đổi áp dụng cho {target.sessions.length} phiên đang được gom hiển thị.</span>
          <div>
            <button type="button" onClick={onClose}>
              Hủy
            </button>
            <button type="button" className="save-button" disabled={saving} onClick={() => void save()}>
              {saving ? 'Đang lưu…' : 'Lưu Activity'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function localMetadataStats(segments: ActivitySegment[], field: 'category' | 'project'): WeeklyStat[] {
  const totals = new Map<string, number>();
  for (const item of segments.filter((segment) => segment.kind === 'active' || segment.kind === 'browser')) {
    const label = item[field];
    if (label) totals.set(label, (totals.get(label) ?? 0) + item.durationSeconds);
  }
  return [...totals]
    .map(([label, durationSeconds]) => ({ label, durationSeconds, category: 'app' as const }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds);
}

function GameReport({ segments }: { segments: ActivitySegment[] }) {
  const games = groupActivities(segments).filter((group) => group.isGame);
  if (!games.length)
    return (
      <TrackerCard title="Game" className="game-report">
        <div className="empty-dark">Chưa ghi nhận phiên chơi game trong khoảng này.</div>
      </TrackerCard>
    );
  const sessions = games.flatMap((game) => game.sessions);
  const total = sessions.reduce((sum, item) => sum + item.durationSeconds, 0);
  const longest = Math.max(0, ...sessions.map((item) => item.durationSeconds));
  const matchTime = games
    .flatMap((game) => game.details)
    .filter((detail) => detail.label === 'Trong trận')
    .reduce((sum, detail) => sum + detail.durationSeconds, 0);
  const clientTime = games
    .flatMap((game) => game.details)
    .filter((detail) => detail.label === 'League Client')
    .reduce((sum, detail) => sum + detail.durationSeconds, 0);
  return (
    <TrackerCard title="Báo cáo game" className="game-report">
      <div className="game-metrics">
        <div>
          <span>Tổng thời gian</span>
          <strong>{formatDuration(total)}</strong>
        </div>
        <div>
          <span>Trong trận</span>
          <strong>{formatDuration(matchTime)}</strong>
        </div>
        <div>
          <span>Ở client</span>
          <strong>{formatDuration(clientTime)}</strong>
        </div>
        <div>
          <span>Phiên dài nhất</span>
          <strong>{formatDuration(longest)}</strong>
        </div>
      </div>
      <div className="game-list">
        {games.map((game) => (
          <div key={game.key}>
            <span className="color-dot" style={{ background: colorForLabel(game.app) }} />
            <strong>{game.app}</strong>
            <small>{game.sessions.length} phiên foreground</small>
            <time>{formatDuration(game.durationSeconds)}</time>
          </div>
        ))}
      </div>
    </TrackerCard>
  );
}

function FullReport({ stats, segments }: { stats: WeeklyStat[]; segments: ActivitySegment[] }) {
  const renderGroup = (category: WeeklyStat['category']) => (
    <div className="report-list">
      {topStats(stats, category, 20).map((item, index) => (
        <div className="report-row" key={`${category}-${item.label}`}>
          <span>{index + 1}</span>
          <i style={{ background: colorForLabel(item.label) }} />
          <strong>{item.label}</strong>
          <time>{formatDuration(item.durationSeconds)}</time>
        </div>
      ))}
    </div>
  );
  const renderMetadata = (field: 'category' | 'project') => (
    <div className="report-list">
      {localMetadataStats(segments, field)
        .slice(0, 20)
        .map((item, index) => (
          <div className="report-row" key={`${field}-${item.label}`}>
            <span>{index + 1}</span>
            <i style={{ background: colorForLabel(item.label) }} />
            <strong>{item.label}</strong>
            <time>{formatDuration(item.durationSeconds)}</time>
          </div>
        ))}
    </div>
  );
  return (
    <div className="report-page">
      <GameReport segments={segments} />
      <div className="report-grid">
        <TrackerCard title="Ứng dụng được dùng nhiều nhất">{renderGroup('app')}</TrackerCard>
        <TrackerCard title="Website được dùng nhiều nhất">{renderGroup('domain')}</TrackerCard>
        <TrackerCard title="Categories">{renderMetadata('category')}</TrackerCard>
        <TrackerCard title="Projects">{renderMetadata('project')}</TrackerCard>
      </div>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>('overview');
  const [status, setStatus] = useState<CollectorStatus>();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [periodDays, setPeriodDays] = useState(30);
  const [date, setDate] = useState(todayInputValue());
  const [periodSegments, setPeriodSegments] = useState<ActivitySegment[]>([]);
  const [daySegments, setDaySegments] = useState<ActivitySegment[]>([]);
  const [stats, setStats] = useState<WeeklyStat[]>([]);
  const [searchResults, setSearchResults] = useState<ActivitySegment[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ActivityKind | ''>('');
  const [selectedActivity, setSelectedActivity] = useState<string>();
  const [editTarget, setEditTarget] = useState<ActivityEditTarget>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [browserIntegrationMessage, setBrowserIntegrationMessage] = useState<string>();

  const loadPeriod = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const range = periodRange(periodDays);
      const [segments, distribution] = await Promise.all([
        window.activityJournal.getTimeline(range),
        window.activityJournal.getWeeklyStats(range),
      ]);
      setPeriodSegments(segments);
      setStats(distribution);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [periodDays]);

  const loadDay = useCallback(async () => {
    try {
      setDaySegments(await window.activityJournal.getTimeline(localDayRange(date)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [date]);

  useEffect(() => {
    void Promise.all([
      loadPeriod(),
      loadDay(),
      window.activityJournal.getStatus().then(setStatus),
      window.activityJournal.getSettings().then(setSettings),
    ]);
    return window.activityJournal.onStatusChanged(setStatus);
  }, [loadDay, loadPeriod]);
  useEffect(() => {
    setSelectedActivity(undefined);
  }, [date]);

  const hourValues = useMemo(() => distributeByHour(periodSegments), [periodSegments]);
  const weekdayValues = useMemo(() => distributeByWeekday(periodSegments), [periodSegments]);
  const total = useMemo(() => trackedSeconds(periodSegments), [periodSegments]);
  const averagePerWeek = total / Math.max(1, periodDays / 7);
  const appCount = topStats(stats, 'app', 100).length;
  const classifiedPeriodSegments = useMemo(
    () => classifySegments(periodSegments, settings.classificationRules ?? []),
    [periodSegments, settings.classificationRules],
  );
  const classifiedDaySegments = useMemo(
    () => classifySegments(daySegments, settings.classificationRules ?? []),
    [daySegments, settings.classificationRules],
  );
  const classifiedSearchResults = useMemo(
    () => classifySegments(searchResults, settings.classificationRules ?? []),
    [searchResults, settings.classificationRules],
  );

  async function runSearch() {
    setBusy(true);
    try {
      setSearchResults(
        await window.activityJournal.search({
          query: query.trim() || undefined,
          ...periodRange(periodDays),
          kinds: kind ? [kind] : undefined,
          limit: 500,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    setStatus(
      status?.paused ? await window.activityJournal.resume() : await window.activityJournal.pause(15),
    );
  }
  async function saveSettings() {
    setBusy(true);
    try {
      const autoStart = await window.activityJournal.setAutoStart(settings.autoStart);
      setSettings(await window.activityJournal.updateSettings({ ...settings, autoStart }));
    } finally {
      setBusy(false);
    }
  }
  async function repairBrowserIntegration() {
    setBusy(true);
    setBrowserIntegrationMessage(undefined);
    try {
      const result = await window.activityJournal.repairBrowserIntegration();
      setBrowserIntegrationMessage(
        result.registered
          ? 'Đã đăng ký lại kết nối. Hãy đóng hoàn toàn rồi mở lại Chrome/Edge.'
          : 'Không thể đăng ký kết nối trình duyệt.',
      );
    } catch (cause) {
      setBrowserIntegrationMessage(
        `Không thể sửa kết nối: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  function updateRule(index: number, patch: Partial<ExclusionRule>) {
    setSettings((current) => ({
      ...current,
      exclusions: current.exclusions.map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  }
  function updateClassificationRule(index: number, patch: Partial<ClassificationRule>) {
    setSettings((current) => ({
      ...current,
      classificationRules: (current.classificationRules ?? []).map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  }

  const nav: Array<[View, string, string]> = [
    ['overview', '◴', 'Tổng quan'],
    ['timeline', '▤', 'Timeline'],
    ['search', '⌕', 'Tìm kiếm'],
    ['reports', '▥', 'Báo cáo'],
    ['settings', '⚙', 'Cài đặt'],
  ];
  return (
    <div className="tracker-shell">
      <aside className="tracker-sidebar">
        <div className="tracker-brand">
          <span>AJ</span>
          <div>
            <strong>Activity Journal</strong>
            <small>PRIVATE TRACKER</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button className={view === id ? 'active' : ''} onClick={() => setView(id)} key={id}>
              <i>{icon}</i>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className={`collector-state ${status?.paused ? 'paused' : ''}`}>
          <span />
          <div>
            <strong>
              {status?.paused ? 'Đang tạm dừng' : status?.running ? 'Đang ghi' : 'Collector offline'}
            </strong>
            <small>{status?.databaseEncrypted ? 'SQLCipher + DPAPI' : 'Đang kết nối…'}</small>
          </div>
        </div>
      </aside>
      <main className="tracker-main">
        <header className="tracker-toolbar">
          <div className="window-title">
            <strong>
              {view === 'overview'
                ? 'Overview'
                : view === 'timeline'
                  ? 'Daily timeline'
                  : view === 'search'
                    ? 'Search activity'
                    : view === 'reports'
                      ? 'Reports'
                      : 'Settings'}
            </strong>
            <span>Local-only activity tracking</span>
          </div>
          <div className="toolbar-actions">
            <select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))}>
              <option value="7">7 ngày</option>
              <option value="30">30 ngày</option>
              <option value="90">90 ngày</option>
            </select>
            <button className={status?.paused ? 'resume-button' : ''} onClick={() => void togglePause()}>
              {status?.paused ? '▶ Tiếp tục' : 'Ⅱ Tạm dừng 15 phút'}
            </button>
          </div>
        </header>
        {error && <div className="tracker-error">{error}</div>}

        {view === 'overview' && (
          <div className="overview-grid">
            <TrackerCard title="Tổng thời gian" className="metric-card">
              <strong>{formatDuration(total)}</strong>
              <span>{formatDuration(averagePerWeek)} mỗi tuần</span>
            </TrackerCard>
            <TrackerCard title="Các ngày hoạt động nhiều">
              <Histogram
                values={weekdayValues}
                labels={weekdayLabels}
                tooltipFor={(value, index) => `${weekdayLabels[index]} · ${formatDuration(value)}`}
              />
            </TrackerCard>
            <TrackerCard title="Các giờ hoạt động nhiều">
              <Histogram
                values={hourValues}
                labels={Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? String(i) : ''))}
                tooltipFor={(value, index) =>
                  `${String(index).padStart(2, '0')}:00–${String((index + 1) % 24).padStart(2, '0')}:00 · ${formatDuration(value)}`
                }
              />
            </TrackerCard>
            <TrackerCard title="Ứng dụng đã theo dõi" className="metric-card accent-metric">
              <strong>{appCount}</strong>
              <span>trong {periodDays} ngày gần nhất</span>
            </TrackerCard>
            <TrackerCard title={`Thời gian hoạt động · ${periodDays} ngày`} className="daily-card">
              <DailyChart segments={periodSegments} days={periodDays} />
            </TrackerCard>
            <DistributionPanel title="Ứng dụng" stats={stats} category="app" />
            <DistributionPanel title="Website" stats={stats} category="domain" />
          </div>
        )}

        {view === 'timeline' && (
          <div className="page-stack">
            <div className="page-controls">
              <label>
                Ngày
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <strong>{formatDuration(trackedSeconds(classifiedDaySegments))} hoạt động</strong>
            </div>
            <TrackerCard title="Hoạt động theo giờ">
              <ActivityTrack
                segments={classifiedDaySegments}
                date={date}
                selectedActivity={selectedActivity}
                onSelect={setSelectedActivity}
              />
            </TrackerCard>
            <TrackerCard title="Activities đã gom nhóm">
              <GroupedActivities
                segments={classifiedDaySegments}
                selectedActivity={selectedActivity}
                onSelect={setSelectedActivity}
                onEdit={setEditTarget}
              />
            </TrackerCard>
          </div>
        )}

        {view === 'search' && (
          <div className="page-stack">
            <div className="search-panel">
              <input
                value={query}
                placeholder="Tìm ứng dụng, tiêu đề, domain, project hoặc ghi chú…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void runSearch()}
              />
              <select value={kind} onChange={(event) => setKind(event.target.value as ActivityKind | '')}>
                <option value="">Tất cả loại</option>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button onClick={() => void runSearch()} disabled={busy}>
                {busy ? 'Đang tìm…' : 'Tìm kiếm'}
              </button>
            </div>
            <TrackerCard title={`${searchResults.length} kết quả`}>
              <ActivityTable segments={classifiedSearchResults} />
            </TrackerCard>
          </div>
        )}

        {view === 'reports' && <FullReport stats={stats} segments={classifiedPeriodSegments} />}

        {view === 'settings' && (
          <div className="settings-grid">
            <TrackerCard title="Theo dõi nền">
              <label className="setting-toggle">
                <span>
                  <strong>Tự chạy khi đăng nhập</strong>
                  <small>Khởi động ẩn trong system tray.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(event) => setSettings({ ...settings, autoStart: event.target.checked })}
                />
              </label>
              <label className="setting-field">
                Ngưỡng idle (giây)
                <input
                  type="number"
                  min="60"
                  max="3600"
                  value={settings.idleThresholdSeconds}
                  onChange={(event) =>
                    setSettings({ ...settings, idleThresholdSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label className="setting-field">
                Lưu dữ liệu (ngày)
                <input
                  type="number"
                  min="1"
                  max="3650"
                  value={settings.retentionDays}
                  onChange={(event) =>
                    setSettings({ ...settings, retentionDays: Number(event.target.value) })
                  }
                />
              </label>
            </TrackerCard>
            <TrackerCard title="Chrome & Edge">
              <p className="settings-copy">
                Extension chỉ gửi tiêu đề và hostname của tab active. Không lưu URL đầy đủ hoặc nội dung
                trang.
              </p>
              <div className="browser-integration-actions">
                <button
                  className="secondary-button"
                  onClick={() => void window.activityJournal.openExtensionFolder()}
                >
                  Mở thư mục extension
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void repairBrowserIntegration()}
                >
                  {busy ? 'Đang sửa…' : 'Sửa kết nối trình duyệt'}
                </button>
              </div>
              {browserIntegrationMessage && (
                <p className="browser-integration-message" role="status">
                  {browserIntegrationMessage}
                </p>
              )}
            </TrackerCard>
            <TrackerCard title="Tự động phân loại Project & Category" className="settings-wide">
              <div className="rule-heading">
                <p>Rule được áp dụng khi hiển thị; metadata gốc không bị thay đổi.</p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      classificationRules: [
                        ...(settings.classificationRules ?? []),
                        { matchType: 'app', pattern: '', category: '', project: '' },
                      ],
                    })
                  }
                >
                  + Thêm rule
                </button>
              </div>
              {(settings.classificationRules ?? []).map((rule, index) => (
                <div className="classification-rule-row" key={rule.id ?? index}>
                  <select
                    value={rule.matchType}
                    onChange={(event) =>
                      updateClassificationRule(index, {
                        matchType: event.target.value as ClassificationRule['matchType'],
                      })
                    }
                  >
                    <option value="app">Ứng dụng</option>
                    <option value="domain">Domain</option>
                    <option value="title">Tiêu đề</option>
                  </select>
                  <input
                    value={rule.pattern}
                    onChange={(event) => updateClassificationRule(index, { pattern: event.target.value })}
                    placeholder="Chứa từ khóa…"
                  />
                  <input
                    value={rule.category ?? ''}
                    onChange={(event) => updateClassificationRule(index, { category: event.target.value })}
                    placeholder="Category"
                  />
                  <input
                    value={rule.project ?? ''}
                    onChange={(event) => updateClassificationRule(index, { project: event.target.value })}
                    placeholder="Project"
                  />
                  <button
                    onClick={() =>
                      setSettings({
                        ...settings,
                        classificationRules: (settings.classificationRules ?? []).filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                  >
                    Xóa
                  </button>
                </div>
              ))}
            </TrackerCard>
            <TrackerCard title="Danh sách loại trừ" className="settings-wide">
              <div className="rule-heading">
                <p>Quy tắc được áp dụng trước khi ghi DB.</p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      exclusions: [...settings.exclusions, { type: 'app', pattern: '' }],
                    })
                  }
                >
                  + Thêm quy tắc
                </button>
              </div>
              {settings.exclusions.map((rule, index) => (
                <div className="rule-row" key={rule.id ?? index}>
                  <select
                    value={rule.type}
                    onChange={(event) =>
                      updateRule(index, { type: event.target.value as ExclusionRule['type'] })
                    }
                  >
                    <option value="app">Ứng dụng</option>
                    <option value="domain">Domain</option>
                    <option value="title">Tiêu đề chứa</option>
                    <option value="path">Đường dẫn</option>
                  </select>
                  <input
                    value={rule.pattern}
                    onChange={(event) => updateRule(index, { pattern: event.target.value })}
                    placeholder="Giá trị cần loại trừ"
                  />
                  <button
                    onClick={() =>
                      setSettings({
                        ...settings,
                        exclusions: settings.exclusions.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                  >
                    Xóa
                  </button>
                </div>
              ))}
            </TrackerCard>
            <div className="settings-actions">
              <button
                className="danger-button"
                onClick={() => void window.activityJournal.deleteData({ all: true })}
              >
                Xóa toàn bộ dữ liệu
              </button>
              <button className="save-button" disabled={busy} onClick={() => void saveSettings()}>
                Lưu cài đặt
              </button>
            </div>
          </div>
        )}
      </main>
      {editTarget && (
        <ActivityEditor
          key={`${editTarget.label}-${editTarget.sessions.map((item) => item.id).join('-')}`}
          target={editTarget}
          onClose={() => setEditTarget(undefined)}
          onSaved={async () => {
            await Promise.all([loadDay(), loadPeriod()]);
          }}
        />
      )}
    </div>
  );
}
