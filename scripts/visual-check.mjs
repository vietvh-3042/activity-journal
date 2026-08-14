import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.error('PAGE_ERROR', error));
await page.addInitScript(() => {
  const colors = ['Code', 'Google Chrome', 'File Explorer', 'Word', 'Terminal'];
  const now = new Date();
  const segments = [];
  let id = 1;
  for (let day = 0; day < 30; day += 1) {
    for (let item = 0; item < 5; item += 1) {
      const start = new Date(now);
      start.setDate(start.getDate() - day);
      start.setHours(8 + item * 2, item * 7, 0, 0);
      const end = new Date(start.getTime() + (35 + ((day + item) % 70)) * 60_000);
      segments.push({
        id: id++,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        kind: item === 1 ? 'browser' : 'active',
        app: item === 1 ? 'Google Chrome' : colors[item],
        title: item === 1 ? 'Activity research' : `${colors[item]} workspace`,
        domain: item === 1 ? 'example.com' : undefined,
        source: 'visual_check',
        confidence: 'high',
        durationSeconds: (end - start) / 1000,
      });
    }
  }
  const leagueClientStart = new Date(now);
  leagueClientStart.setHours(17, 20, 0, 0);
  const leagueClientEnd = new Date(leagueClientStart.getTime() + 15 * 60_000);
  const leagueMatchStart = new Date(now);
  leagueMatchStart.setHours(18, 0, 0, 0);
  const leagueMatchEnd = new Date(leagueMatchStart.getTime() + 90 * 60_000);
  segments.push({
    id: id++,
    startUtc: leagueClientStart.toISOString(),
    endUtc: leagueClientEnd.toISOString(),
    kind: 'active',
    app: 'LeagueClientUx',
    title: 'League of Legends',
    source: 'visual_check',
    confidence: 'high',
    durationSeconds: 900,
  });
  segments.push({
    id: id++,
    startUtc: leagueMatchStart.toISOString(),
    endUtc: leagueMatchEnd.toISOString(),
    kind: 'active',
    app: 'League of Legends',
    title: 'League of Legends (TM) Client',
    source: 'visual_check',
    confidence: 'high',
    durationSeconds: 5400,
  });
  const stats = [
    ['League of Legends', 110000, 'app'],
    ['LeagueClientUx', 20000, 'app'],
    ['Code', 93000, 'app'],
    ['Google Chrome', 77000, 'app'],
    ['Terminal', 44000, 'app'],
    ['Word', 26000, 'app'],
    ['File Explorer', 17000, 'app'],
    ['github.com', 34000, 'domain'],
    ['youtube.com', 24000, 'domain'],
    ['openai.com', 19000, 'domain'],
    ['google.com', 13000, 'domain'],
    ['docs.microsoft.com', 8000, 'domain'],
  ].map(([label, durationSeconds, category]) => ({ label, durationSeconds, category }));
  window.activityJournal = {
    getStatus: async () => ({
      apiVersion: 1,
      running: true,
      paused: false,
      pauseIndefinitely: false,
      databaseEncrypted: true,
    }),
    getTimeline: async ({ fromUtc, toUtc }) =>
      segments.filter((item) => item.startUtc < toUtc && item.endUtc >= fromUtc),
    getWeeklyStats: async () => stats,
    getSettings: async () => ({
      autoStart: true,
      idleThresholdSeconds: 300,
      retentionDays: 90,
      exclusions: [],
      classificationRules: [
        { matchType: 'app', pattern: 'Code', category: 'Công việc', project: 'Activity Journal' },
      ],
    }),
    search: async () => segments.slice(0, 20),
    updateSettings: async (settings) => settings,
    pause: async () => ({
      apiVersion: 1,
      running: true,
      paused: true,
      pauseIndefinitely: false,
      databaseEncrypted: true,
    }),
    resume: async () => ({
      apiVersion: 1,
      running: true,
      paused: false,
      pauseIndefinitely: false,
      databaseEncrypted: true,
    }),
    deleteData: async () => ({ deleted: 0 }),
    setAutoStart: async (enabled) => enabled,
    annotateSegments: async ({ ids, category, project, note }) => {
      for (const item of segments.filter((segment) => ids.includes(segment.id)))
        Object.assign(item, { category, project, note });
      return { updated: ids.length };
    },
    openExtensionFolder: async () => undefined,
    repairBrowserIntegration: async () => ({
      registered: true,
      extensionId: 'bkbaolcobjbcpjkbneipppmgmneemegf',
      manifestPath: 'C:\\Activity Journal\\com.activity_journal.host.json',
    }),
    onStatusChanged: () => () => undefined,
  };
});
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/activity-journal-overview.png', fullPage: true });
await page.locator('.histogram-column').nth(16).hover();
await page.waitForTimeout(250);
await page.screenshot({ path: '/tmp/activity-journal-overview-hover.png', fullPage: true });
await page.locator('.donut-arc').first().dispatchEvent('mouseover');
await page.waitForTimeout(250);
await page.screenshot({ path: '/tmp/activity-journal-overview-donut.png', fullPage: true });
await page.getByRole('button', { name: /Timeline/ }).click();
await page.locator('.expand-button').first().click();
await page.locator('.detail-group-row').first().click();
await page.getByRole('button', { name: 'Tập trung' }).click();
if ((await page.locator('.track-zoom-actions > span').textContent()) !== '3 giờ')
  throw new Error('Track focus did not choose the expected 3-hour zoom');
await page
  .locator('.track-lane')
  .first()
  .hover({ position: { x: 700, y: 18 } });
await page.mouse.wheel(0, -120);
await page.waitForTimeout(220);
if ((await page.locator('.track-zoom-actions > span').textContent()) !== '1 giờ')
  throw new Error('Mouse wheel zoom-in did not reach 1 hour');
await page.mouse.wheel(0, 120);
await page.waitForTimeout(220);
if ((await page.locator('.track-zoom-actions > span').textContent()) !== '3 giờ')
  throw new Error('Mouse wheel zoom-out did not return to 3 hours');
if ((await page.evaluate(() => window.scrollY)) !== 0)
  throw new Error('Mouse wheel zoom unexpectedly scrolled the page');
const emptyLane = await page.locator('.track-lane').nth(1).boundingBox();
if (!emptyLane) throw new Error('Missing track lane for drag zoom');
await page.mouse.move(emptyLane.x + 180, emptyLane.y + 18);
await page.mouse.down();
await page.mouse.move(emptyLane.x + 380, emptyLane.y + 18, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(220);
if ((await page.locator('.track-zoom-actions > span').textContent()) !== '1 giờ')
  throw new Error('Drag selection did not zoom to 1 hour');
await page.getByRole('button', { name: 'Tập trung' }).click();
await page.locator('.detail-group-row').first().locator('.edit-activity-button').click();
await page.getByLabel('Ghi chú').fill('Hai trận xếp hạng buổi tối');
await page.getByRole('button', { name: 'Lưu Activity' }).click();
await page.getByText('Hai trận xếp hạng buổi tối').waitFor();
await page.locator('.time-block.is-highlighted').first().hover();
await page.waitForTimeout(250);
await page.screenshot({ path: '/tmp/activity-journal-timeline.png', fullPage: true });
await page.getByRole('button', { name: /Báo cáo/ }).click();
await page.screenshot({ path: '/tmp/activity-journal-reports.png', fullPage: true });
await page.getByRole('button', { name: /Cài đặt/ }).click();
await page.getByRole('button', { name: 'Sửa kết nối trình duyệt' }).click();
await page.getByRole('status').filter({ hasText: 'Đã đăng ký lại kết nối' }).waitFor();
await page.screenshot({ path: '/tmp/activity-journal-settings.png', fullPage: true });
await browser.close();
