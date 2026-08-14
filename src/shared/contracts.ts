export const API_VERSION = 1;

export type ActivityKind =
  | 'active'
  | 'browser'
  | 'idle'
  | 'locked'
  | 'suspended'
  | 'paused'
  | 'excluded'
  | 'app_open'
  | 'app_close'
  | 'file_hint';

export type Confidence = 'high' | 'medium' | 'low';

export interface ActivitySegment {
  id: number;
  startUtc: string;
  endUtc: string;
  kind: ActivityKind;
  app?: string;
  title?: string;
  domain?: string;
  path?: string;
  source: string;
  confidence: Confidence;
  durationSeconds: number;
  category?: string;
  project?: string;
  note?: string;
}

export interface SearchRequest {
  query?: string;
  fromUtc?: string;
  toUtc?: string;
  kinds?: ActivityKind[];
  app?: string;
  domain?: string;
  limit?: number;
  offset?: number;
}

export interface TimelineRequest {
  fromUtc: string;
  toUtc: string;
}

export interface WeeklyStatsRequest {
  fromUtc: string;
  toUtc: string;
}

export interface WeeklyStat {
  label: string;
  category: 'app' | 'domain';
  durationSeconds: number;
}

export interface ExclusionRule {
  id?: number;
  type: 'app' | 'domain' | 'title' | 'path';
  pattern: string;
}

export interface ClassificationRule {
  id?: number;
  matchType: 'app' | 'domain' | 'title';
  pattern: string;
  category?: string;
  project?: string;
}

export interface Settings {
  autoStart: boolean;
  idleThresholdSeconds: number;
  retentionDays: number;
  exclusions: ExclusionRule[];
  classificationRules: ClassificationRule[];
}

export interface AnnotateSegmentsRequest {
  ids: number[];
  category?: string;
  project?: string;
  note?: string;
}

export interface BrowserIntegrationResult {
  registered: boolean;
  extensionId: string;
  manifestPath: string;
}

export interface CollectorStatus {
  apiVersion: number;
  running: boolean;
  paused: boolean;
  pausedUntilUtc?: string;
  pauseIndefinitely: boolean;
  databaseEncrypted: boolean;
  extensionConnectedAtUtc?: string;
}

export interface DeleteRequest {
  fromUtc?: string;
  toUtc?: string;
  all?: boolean;
}

export interface ActivityJournalApi {
  getStatus(): Promise<CollectorStatus>;
  search(request: SearchRequest): Promise<ActivitySegment[]>;
  getTimeline(request: TimelineRequest): Promise<ActivitySegment[]>;
  getWeeklyStats(request: WeeklyStatsRequest): Promise<WeeklyStat[]>;
  getSettings(): Promise<Settings>;
  updateSettings(settings: Settings): Promise<Settings>;
  annotateSegments(request: AnnotateSegmentsRequest): Promise<{ updated: number }>;
  pause(minutes?: number): Promise<CollectorStatus>;
  resume(): Promise<CollectorStatus>;
  deleteData(request: DeleteRequest): Promise<{ deleted: number }>;
  setAutoStart(enabled: boolean): Promise<boolean>;
  openExtensionFolder(): Promise<void>;
  repairBrowserIntegration(): Promise<BrowserIntegrationResult>;
  onStatusChanged(callback: (status: CollectorStatus) => void): () => void;
}
