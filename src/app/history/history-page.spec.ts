import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { ApplicationSummary, ConfigurationRevision } from '../api/dto';
import { routes } from '../app.routes';

const APPLICATIONS = '/configuration/api/applications';

/** The env-addressed history read — the ONLY spelling this page uses. */
function historyUrl(env: string): string {
  return `/configuration/api/applications/qits-docs/envs/${env}/history`;
}

/**
 * The write log for one tier, newest first.
 *
 * Four assertions carry this file. **The order is the service's**, so a row order asserted here is
 * the order the response arrived in and never a sort this page applied — `seq` is the append-only
 * sequence the deployer quotes, and re-sorting it would disagree with the store on any tie.
 * **A deletion is drawn as a word**, because an entry may hold the empty string: a blank cell would
 * have merged the two most different events in this log. **The env is in the read's address**, so
 * every expectation below names the tier it is about — a spec that let an env-less URL through would
 * be a spec that could not tell prod's log from dev's. And **the env-less spelling settles without
 * rewriting the address**, which is the one behaviour a reader could mistake for a redirect and the
 * one this file therefore pins hardest.
 */
describe('HistoryPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const revision = (over: Partial<ConfigurationRevision> = {}): ConfigurationRevision => ({
    seq: 41,
    env: 'dev',
    application: 'qits-docs',
    key: 'env.QITS_REGISTRY',
    value: 'registry.dev.localhost:8080',
    deleted: false,
    updatedAt: '2026-08-17T09:12:03Z',
    updatedBy: 'wohlben',
    ...over,
  });

  /**
   * The listing row for this application. The counts are filler: nothing on this page reads them,
   * and the tiers — in the order the service sends them — are the whole of what it does read.
   */
  const summary = (envs: readonly string[]): ApplicationSummary => ({
    application: 'qits-docs',
    envs: envs.map((env, index) => ({ env, entries: 3, headRevision: 40 + index })),
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  /** Open the page at `url` and answer the applications listing with these tiers. */
  async function arrive(url: string, envs: readonly string[] = ['dev', 'prod']): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    http.expectOne(APPLICATIONS).flush({ applications: [summary(envs)] });
    await settle();
  }

  /**
   * Answer the history read for one tier. It is expected AFTER the listing has been answered in
   * every case, which works for both spellings: with the env in the address the request is already
   * out and waiting, and without it, it is the listing that let it go.
   */
  async function answer(env: string, revisions: readonly ConfigurationRevision[]): Promise<void> {
    http.expectOne(historyUrl(env)).flush({ revisions });
    await settle();
  }

  /** The ordinary arrival: the address names dev, and dev's log comes back. */
  async function open(revisions: readonly ConfigurationRevision[]): Promise<void> {
    await arrive('/applications/qits-docs/envs/dev/history');
    await answer('dev', revisions);
  }

  it('draws the log in the order the service sent it', async () => {
    await open([
      revision({ seq: 43, key: 'env.LATER', value: 'two' }),
      revision({ seq: 42, key: 'env.EARLIER', value: 'one' }),
    ]);

    const rows = page().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('43');
    expect(rows[0].textContent).toContain('env.LATER');
    expect(rows[1].textContent).toContain('42');
    http.verify();
  });

  it('draws every column a row carries: who wrote it and when, in UTC', async () => {
    await open([revision()]);

    const row = page().querySelector('tbody tr');
    expect(row?.textContent).toContain('wohlben');
    expect(row?.textContent).toContain('17 Aug 2026 09:12:03Z');
    http.verify();
  });

  it('says “deleted” for a removed entry rather than drawing a blank cell', async () => {
    await open([revision({ seq: 44, value: null, deleted: true })]);

    const value = page().querySelector('tbody td.value');
    expect(value?.textContent?.trim()).toBe('deleted');
    http.verify();
  });

  it('tells a blanked value apart from a deleted one', async () => {
    await open([revision({ seq: 45, value: '', deleted: false })]);

    const value = page().querySelector('tbody td.value');
    expect(value?.textContent?.trim()).toBe('(empty)');
    http.verify();
  });

  it('says nothing has been written rather than drawing an empty table', async () => {
    await open([]);

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('Nothing has been written');
    http.verify();
  });

  it('reads the tier the address names, and says which one it is reading', async () => {
    await arrive('/applications/qits-docs/envs/prod/history');
    await answer('prod', [revision({ env: 'prod' })]);

    // The read is the assertion: `answer` would have failed on any other URL, and there is no
    // env-less history route left for this page to fall back to.
    expect(page().querySelector('.title')?.textContent).toContain('prod');
    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('says which environment the revision numbers are shared with', async () => {
    await open([revision()]);

    expect(page().textContent).toContain('not this environment');
    http.verify();
  });

  it('settles the env-less address on the first tier the listing gives, and leaves the URL alone', async () => {
    await arrive('/applications/qits-docs/history', ['dev', 'prod']);
    await answer('dev', [revision()]);

    // Settling is an answer, not a redirect: the address a reader pasted is the address they keep,
    // and a rewrite here would make Back walk through a URL nobody chose.
    expect(TestBed.inject(Router).url).toBe('/applications/qits-docs/history');
    expect(page().querySelector('.title')?.textContent).toContain('dev');
    http.verify();
  });

  it('shows the settled tier in the picker even though nothing named it', async () => {
    await arrive('/applications/qits-docs/history', ['dev', 'prod']);
    await answer('dev', [revision()]);

    expect(page().querySelector('.tier .qits-picker-value')?.textContent?.trim()).toBe('dev');
    http.verify();
  });

  it('offers every tier the listing gives and pushes to the one that is picked', async () => {
    await arrive('/applications/qits-docs/envs/dev/history', ['dev', 'integration', 'prod']);
    await answer('dev', [revision()]);

    // A settled picker is collapsed onto its value, so the choices come back the way a reader gets
    // them back: by clearing. Clearing itself must NOT navigate — it opens the list and no more.
    page().querySelector<HTMLButtonElement>('.tier .qits-picker-clear')?.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/applications/qits-docs/envs/dev/history');

    const options = Array.from(page().querySelectorAll<HTMLElement>('.tier li.qits-picker-option'));
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'dev',
      'integration',
      'prod',
    ]);

    // Spied rather than merely observed through the URL, because the ARGUMENT is the assertion: no
    // `replaceUrl`, so a pick is a step Back undoes.
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    options[2].click();
    await settle();

    expect(navigate.mock.calls).toHaveLength(1);
    expect(navigate.mock.calls[0]).toHaveLength(1);
    expect(TestBed.inject(Router).url).toBe('/applications/qits-docs/envs/prod/history');

    // Moving tier re-reads the log and nothing else: the listing is the application's, not the
    // env's, so it is not asked for a second time.
    await answer('prod', [revision({ seq: 46, env: 'prod' })]);
    expect(page().querySelector('tbody tr')?.textContent).toContain('46');
    http.verify();
  });

  it('leaves an env-addressed log standing when the tier listing fails', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/envs/prod/history');
    await settle();
    http.expectOne(APPLICATIONS).flush({ message: 'nope' }, { status: 503, statusText: 'Nope' });
    await settle();
    await answer('prod', [revision({ env: 'prod' })]);

    // The address named the tier, so the log is exactly right; all that is lost is the way to
    // another tier, and that is what the error beside the picker says.
    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    expect(page().querySelector('.tier app-async')?.textContent).toContain('503 nope');
    http.verify();
  });

  it('says an application configured in no tier has no history rather than asking for one', async () => {
    await arrive('/applications/qits-docs/history', []);

    expect(page().querySelector('app-empty')?.textContent).toContain(
      'configured in no environment',
    );
    // No env settled means no address to read a history at, so nothing was asked for.
    http.verify();
  });

  it('offers the way back to the listing and to the tier\u2019s own entries', async () => {
    await open([revision()]);

    const crumbs = Array.from(page().querySelectorAll('.crumbs a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(crumbs).toEqual(['/', '/applications/qits-docs/envs/dev']);
    http.verify();
  });

  it('reports a failed read and retries it on request', async () => {
    await arrive('/applications/qits-docs/envs/dev/history');
    http
      .expectOne(historyUrl('dev'))
      .flush({ message: 'nope' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(page().textContent).toContain('503 nope');

    page().querySelector<HTMLButtonElement>('app-async button')?.click();
    await settle();
    await answer('dev', [revision()]);

    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });
});
