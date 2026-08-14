import type { ActivityJournalApi } from '../shared/contracts';

declare global {
  interface Window {
    activityJournal: ActivityJournalApi;
  }
}

export {};
