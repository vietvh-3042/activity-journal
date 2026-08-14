import type { ActivitySegment, ClassificationRule, WeeklyStat } from '../shared/contracts';

export const trackerColors = [
  '#49d6e9',
  '#ff67dc',
  '#ffef68',
  '#2ca7df',
  '#82eb66',
  '#a97af4',
  '#ff8b65',
  '#d83970',
];

export function isTracked(segment: ActivitySegment): boolean {
  return segment.kind === 'active' || segment.kind === 'browser';
}

export function trackedSeconds(segments: ActivitySegment[]): number {
  return segments.filter(isTracked).reduce((total, segment) => total + segment.durationSeconds, 0);
}

export function colorForLabel(label?: string): string {
  if (!label) return '#68717e';
  let hash = 0;
  for (const character of label) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return trackerColors[Math.abs(hash) % trackerColors.length];
}

export function distributeByHour(segments: ActivitySegment[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const segment of segments.filter(isTracked)) {
    let cursor = new Date(segment.startUtc);
    const end = new Date(segment.endUtc);
    while (cursor < end) {
      const boundary = new Date(cursor);
      boundary.setMinutes(60, 0, 0);
      const sliceEnd = boundary < end ? boundary : end;
      hours[cursor.getHours()] += (sliceEnd.getTime() - cursor.getTime()) / 1000;
      cursor = sliceEnd;
    }
  }
  return hours;
}

export function distributeByWeekday(segments: ActivitySegment[]): number[] {
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const segment of segments.filter(isTracked)) {
    let cursor = new Date(segment.startUtc);
    const end = new Date(segment.endUtc);
    while (cursor < end) {
      const boundary = new Date(cursor);
      boundary.setHours(24, 0, 0, 0);
      const sliceEnd = boundary < end ? boundary : end;
      const mondayFirst = (cursor.getDay() + 6) % 7;
      weekdays[mondayFirst] += (sliceEnd.getTime() - cursor.getTime()) / 1000;
      cursor = sliceEnd;
    }
  }
  return weekdays;
}

export interface DayTotal {
  date: string;
  durationSeconds: number;
}

export interface ActivityDetailGroup {
  key: string;
  label: string;
  domain?: string;
  path?: string;
  durationSeconds: number;
  sessions: ActivitySegment[];
  category?: string;
  project?: string;
  note?: string;
}

export interface ActivityAppGroup {
  key: string;
  app: string;
  isGame: boolean;
  durationSeconds: number;
  sessions: ActivitySegment[];
  details: ActivityDetailGroup[];
  category?: string;
  project?: string;
}

interface AppIdentity {
  app: string;
  isGame: boolean;
  mode?: 'in_match' | 'client';
  modeLabel?: string;
}

function compactAppName(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolveAppIdentity(app?: string, title?: string): AppIdentity {
  const compact = compactAppName(app);
  const normalizedTitle = (title ?? '').toLowerCase();
  const isLeagueClient = compact.startsWith('leagueclient') || compact === 'leagueoflegendsclient';
  const isLeagueMatch = compact === 'leagueoflegends' || compact === 'leagueoflegendstmclient';
  const isLeagueRiotClient =
    compact.startsWith('riotclient') && normalizedTitle.includes('league of legends');
  if (isLeagueMatch)
    return { app: 'League of Legends', isGame: true, mode: 'in_match', modeLabel: 'Trong trận' };
  if (isLeagueClient || isLeagueRiotClient)
    return { app: 'League of Legends', isGame: true, mode: 'client', modeLabel: 'League Client' };
  return { app: app || 'Không xác định', isGame: false };
}

export function activityAppLabel(segment: ActivitySegment): string {
  return resolveAppIdentity(segment.app || segment.domain, segment.title).app;
}

export function activityDisplayLabel(segment: ActivitySegment): string {
  const identity = resolveAppIdentity(segment.app, segment.title);
  return identity.modeLabel || segment.title || segment.domain || segment.path || identity.app;
}

export function isGameActivity(segment: ActivitySegment): boolean {
  return resolveAppIdentity(segment.app, segment.title).isGame;
}

export function classifySegments(
  segments: ActivitySegment[],
  rules: ClassificationRule[],
): ActivitySegment[] {
  return segments.map((segment) => {
    let category = segment.category || (isGameActivity(segment) ? 'Game' : undefined);
    let project = segment.project;
    for (const rule of rules) {
      const source =
        rule.matchType === 'app'
          ? activityAppLabel(segment)
          : rule.matchType === 'domain'
            ? segment.domain
            : segment.title;
      if (
        !source ||
        !rule.pattern.trim() ||
        !source.toLowerCase().includes(rule.pattern.trim().toLowerCase())
      )
        continue;
      category ||= rule.category?.trim() || undefined;
      project ||= rule.project?.trim() || undefined;
      if (category && project) break;
    }
    return category === segment.category && project === segment.project
      ? segment
      : { ...segment, category, project };
  });
}

export function activityAppKey(segment: ActivitySegment): string {
  return `app:${activityAppLabel(segment)}`;
}

export function activityDetailKey(segment: ActivitySegment): string {
  const identity = resolveAppIdentity(segment.app, segment.title);
  if (identity.mode) return `detail:${identity.app}|game:${identity.mode}`;
  return `detail:${segment.app || ''}|${segment.domain || ''}|${segment.title || ''}|${segment.path || ''}`;
}

export function groupActivities(segments: ActivitySegment[]): ActivityAppGroup[] {
  const apps = new Map<string, ActivityAppGroup>();
  for (const segment of segments.filter(isTracked)) {
    const identity = resolveAppIdentity(segment.app || segment.domain, segment.title);
    const app = identity.app;
    const appKey = activityAppKey(segment);
    let appGroup = apps.get(appKey);
    if (!appGroup) {
      appGroup = {
        key: appKey,
        app,
        isGame: identity.isGame,
        durationSeconds: 0,
        sessions: [],
        details: [],
        category: segment.category,
        project: segment.project,
      };
      apps.set(appKey, appGroup);
    }
    appGroup.durationSeconds += segment.durationSeconds;
    appGroup.sessions.push(segment);

    const detailKey = activityDetailKey(segment);
    let detail = appGroup.details.find((item) => item.key === detailKey);
    if (!detail) {
      detail = {
        key: detailKey,
        label: identity.modeLabel || segment.title || segment.domain || segment.path || app,
        domain: segment.domain,
        path: segment.path,
        durationSeconds: 0,
        sessions: [],
        category: segment.category,
        project: segment.project,
        note: segment.note,
      };
      appGroup.details.push(detail);
    }
    detail.durationSeconds += segment.durationSeconds;
    detail.sessions.push(segment);
    detail.category ||= segment.category;
    detail.project ||= segment.project;
    detail.note ||= segment.note;
    appGroup.category ||= segment.category;
    appGroup.project ||= segment.project;
  }
  return [...apps.values()]
    .map((group) => ({
      ...group,
      details: group.details.sort((left, right) => right.durationSeconds - left.durationSeconds),
    }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds);
}

export function selectionMatches(segment: ActivitySegment, selection?: string): boolean {
  if (!selection) return true;
  return selection.startsWith('app:')
    ? activityAppKey(segment) === selection
    : activityDetailKey(segment) === selection;
}

export function distributeByDay(segments: ActivitySegment[], days: number, now = new Date()): DayTotal[] {
  const totals = new Map<string, number>();
  const result: DayTotal[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  for (let index = 0; index < days; index += 1) {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    const key = localDateKey(day);
    totals.set(key, 0);
    result.push({ date: key, durationSeconds: 0 });
  }

  for (const segment of segments.filter(isTracked)) {
    let cursor = new Date(segment.startUtc);
    const end = new Date(segment.endUtc);
    while (cursor < end) {
      const boundary = new Date(cursor);
      boundary.setHours(24, 0, 0, 0);
      const sliceEnd = boundary < end ? boundary : end;
      const key = localDateKey(cursor);
      if (totals.has(key))
        totals.set(key, (totals.get(key) ?? 0) + (sliceEnd.getTime() - cursor.getTime()) / 1000);
      cursor = sliceEnd;
    }
  }
  return result.map((day) => ({ ...day, durationSeconds: totals.get(day.date) ?? 0 }));
}

export function topStats(stats: WeeklyStat[], category: WeeklyStat['category'], limit = 10): WeeklyStat[] {
  const grouped = new Map<string, WeeklyStat>();
  for (const item of stats.filter(
    (candidate) => candidate.category === category && candidate.durationSeconds > 0,
  )) {
    const identity = category === 'app' ? resolveAppIdentity(item.label) : undefined;
    const label = identity?.app ?? item.label;
    const current = grouped.get(label);
    grouped.set(label, {
      label,
      category,
      durationSeconds: (current?.durationSeconds ?? 0) + item.durationSeconds,
    });
  }
  return [...grouped.values()]
    .sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, limit);
}

function localDateKey(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
