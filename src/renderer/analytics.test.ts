import { describe, expect, it } from 'vitest';
import type { ActivitySegment } from '../shared/contracts';
import {
  activityAppKey,
  activityDetailKey,
  classifySegments,
  colorForLabel,
  distributeByHour,
  groupActivities,
  selectionMatches,
  topStats,
  trackedSeconds,
} from './analytics';

function segment(
  startUtc: string,
  endUtc: string,
  kind: ActivitySegment['kind'] = 'active',
): ActivitySegment {
  return {
    id: 1,
    startUtc,
    endUtc,
    kind,
    app: 'Editor',
    source: 'test',
    confidence: 'high',
    durationSeconds: (new Date(endUtc).getTime() - new Date(startUtc).getTime()) / 1000,
  };
}

describe('tracker analytics', () => {
  it('splits a segment across hour boundaries', () => {
    const distribution = distributeByHour([segment('2026-08-14T03:30:00.000Z', '2026-08-14T05:15:00.000Z')]);
    expect(distribution.reduce((sum, value) => sum + value, 0)).toBe(6300);
    expect(distribution.filter(Boolean)).toHaveLength(3);
  });

  it('excludes idle time from tracked totals', () => {
    expect(
      trackedSeconds([
        segment('2026-08-14T03:00:00.000Z', '2026-08-14T04:00:00.000Z'),
        segment('2026-08-14T04:00:00.000Z', '2026-08-14T05:00:00.000Z', 'idle'),
      ]),
    ).toBe(3600);
  });

  it('assigns stable colors to labels', () => {
    expect(colorForLabel('Google Chrome')).toBe(colorForLabel('Google Chrome'));
  });

  it('groups sessions by app and detailed activity', () => {
    const first = {
      ...segment('2026-08-14T03:00:00.000Z', '2026-08-14T03:30:00.000Z'),
      app: 'Code',
      title: 'project-a',
    };
    const second = {
      ...segment('2026-08-14T04:00:00.000Z', '2026-08-14T04:15:00.000Z'),
      app: 'Code',
      title: 'project-a',
      id: 2,
    };
    const third = {
      ...segment('2026-08-14T05:00:00.000Z', '2026-08-14T05:10:00.000Z'),
      app: 'Code',
      title: 'project-b',
      id: 3,
    };
    const groups = groupActivities([first, second, third]);
    expect(groups).toHaveLength(1);
    expect(groups[0].durationSeconds).toBe(3300);
    expect(groups[0].details).toHaveLength(2);
    expect(selectionMatches(first, activityAppKey(first))).toBe(true);
  });

  it('groups League processes and separates match time from client time', () => {
    const match = {
      ...segment('2026-08-14T03:00:00.000Z', '2026-08-14T03:30:00.000Z'),
      app: 'League of Legends',
      title: 'League of Legends (TM) Client',
    };
    const client = {
      ...segment('2026-08-14T04:00:00.000Z', '2026-08-14T04:10:00.000Z'),
      app: 'LeagueClientUx',
      title: 'League of Legends',
      id: 2,
    };
    const groups = groupActivities([match, client]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ app: 'League of Legends', isGame: true, durationSeconds: 2400 });
    expect(groups[0].details.map((detail) => detail.label)).toEqual(['Trong trận', 'League Client']);
    expect(selectionMatches(client, activityAppKey(match))).toBe(true);
    expect(selectionMatches(client, activityDetailKey(match))).toBe(false);
  });

  it('combines League processes in application reports', () => {
    const stats = topStats(
      [
        { category: 'app', label: 'League of Legends', durationSeconds: 1800 },
        { category: 'app', label: 'LeagueClientUx', durationSeconds: 600 },
        { category: 'app', label: 'Code', durationSeconds: 1200 },
      ],
      'app',
    );
    expect(stats[0]).toEqual({ category: 'app', label: 'League of Legends', durationSeconds: 2400 });
  });

  it('applies classification rules while preserving manual overrides', () => {
    const automatic = {
      ...segment('2026-08-14T03:00:00.000Z', '2026-08-14T03:30:00.000Z'),
      app: 'Visual Studio Code',
    };
    const manual = { ...automatic, id: 2, category: 'Học tập' };
    const rules = [
      {
        matchType: 'app' as const,
        pattern: 'studio code',
        category: 'Công việc',
        project: 'Activity Journal',
      },
    ];
    expect(classifySegments([automatic], rules)[0]).toMatchObject({
      category: 'Công việc',
      project: 'Activity Journal',
    });
    expect(classifySegments([manual], rules)[0]).toMatchObject({
      category: 'Học tập',
      project: 'Activity Journal',
    });
  });
});
