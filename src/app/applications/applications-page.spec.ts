import { provideHttpClient } from '@angular/common/http';
import type { EnvironmentProviders } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks, provideQitsScope } from '@qits/ui-components';
import type { ApplicationEnvSummary, ApplicationSummary } from '../api/dto';
import { routes } from '../app.routes';

/**
 * The listing, one state at a time.
 *
 * The assertion this file exists for is the first one: **one request, and none per row.** Every
 * tier's entry count and head revision arrive with the listing, so a table of forty applications
 * costs what a table of one costs — and the day someone reaches for "just fetch each application's
 * entries to count them", `http.verify()` fails here.
 *
 * The second is newer and matters as much: **the row draws its tiers, not one number over them.**
 * The listing was reshaped so that `entries` and `headRevision` hang off each environment, because
 * an aggregate alone cannot answer the question this page is opened with — whether prod is missing
 * what dev has. A row that summed the tiers away would compile, look right, and lose exactly that.
 *
 * Driven through the router rather than by constructing the component, which is the house pattern:
 * the page is a lazy route and its own address is part of what it is.
 */
describe('ApplicationsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const envSummary = (over: Partial<ApplicationEnvSummary> = {}): ApplicationEnvSummary => ({
    env: 'dev',
    entries: 3,
    headRevision: 41,
    ...over,
  });

  /**
   * One application as the listing now sends it. `envs` is never empty on the wire — an application
   * is in the listing because some tier of it holds, or once held, an entry — so the default fixture
   * carries a tier rather than an empty array.
   */
  const summary = (over: Partial<ApplicationSummary> = {}): ApplicationSummary => ({
    application: 'qits-docs',
    envs: [envSummary()],
    ...over,
  });

  /**
   * Configured per test rather than in a `beforeEach`, because the scoped cases need one provider
   * more and `TestBed` refuses to be reconfigured once anything has been injected out of it.
   */
  function configure(extra: readonly EnvironmentProviders[] = []): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks([]),
        ...extra,
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  async function open(): Promise<void> {
    configure();
    harness = await RouterTestingHarness.create('/');
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function answer(applications: readonly ApplicationSummary[]): Promise<void> {
    http.expectOne('/configuration/api/applications').flush({ applications });
    await settle();
  }

  it('draws every application in one request, with a line per tier', async () => {
    await open();
    await answer([
      summary({ application: 'qits-docs', envs: [envSummary({ env: 'dev' })] }),
      summary({
        application: 'qits-ci',
        envs: [
          envSummary({ env: 'dev', entries: 12, headRevision: 240 }),
          envSummary({ env: 'prod', entries: 9, headRevision: 238 }),
        ],
      }),
    ]);

    const rows = page().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('qits-docs');
    expect(rows[0].textContent).toContain('rev 41');
    expect(rows[1].textContent).toContain('qits-ci');
    expect(rows[1].querySelectorAll('.envs li')).toHaveLength(2);
    http.verify();
  });

  /**
   * The reshaped listing's whole point, asserted where it can be lost.
   *
   * A single total over the tiers would pass every other test in this file and still be the wrong
   * screen: `21` says nothing about prod holding nine of what dev holds twelve of. So the row must
   * carry both tiers by name with their own counts — and the total, which is drawn, must be a link
   * to the matrix rather than a number standing on its own.
   */
  it('breaks the numbers down per environment rather than summing them away', async () => {
    await open();
    await answer([
      summary({
        application: 'qits-ci',
        envs: [
          envSummary({ env: 'dev', entries: 12, headRevision: 240 }),
          envSummary({ env: 'prod', entries: 9, headRevision: 238 }),
        ],
      }),
    ]);

    const tiers = page().querySelectorAll('tbody .envs li');
    expect(tiers).toHaveLength(2);
    expect(tiers[0].textContent).toContain('dev');
    expect(tiers[0].textContent).toContain('12 entries');
    expect(tiers[0].textContent).toContain('rev 240');
    expect(tiers[1].textContent).toContain('prod');
    expect(tiers[1].textContent).toContain('9 entries');

    // Each tier is its own door, addressed with the env in it.
    expect(tiers[1].querySelector('a')?.getAttribute('href')).toBe(
      '/applications/qits-ci/envs/prod',
    );

    // The aggregate is drawn once and only as the way to the page where the comparison is complete.
    const total = page().querySelector('tbody .total');
    expect(total?.textContent?.trim()).toBe('21');
    expect(total?.getAttribute('href')).toBe('/applications/qits-ci/matrix');
    http.verify();
  });

  it('links each application to its own env-less page', async () => {
    await open();
    await answer([summary({ application: 'qits-docs' })]);

    // The env-less spelling means "whichever tier this application has" — the listing knows the
    // tiers and deliberately does not pick one on the reader's behalf.
    const link = page().querySelector('tbody a');
    expect(link?.getAttribute('href')).toBe('/applications/qits-docs');
    http.verify();
  });

  it('keeps an application whose entries have all been deleted, at zero', async () => {
    await open();
    await answer([
      summary({
        application: 'qits-stt',
        envs: [envSummary({ env: 'dev', entries: 0, headRevision: 9 })],
      }),
    ]);

    const row = page().querySelector('tbody tr');
    expect(row?.textContent).toContain('qits-stt');
    expect(row?.textContent).toContain('0 entries');
    expect(row?.textContent).toContain('rev 9');
    expect(page().querySelector('app-empty')).toBeNull();
    http.verify();
  });

  it('says the list is empty in a sentence rather than as blank space', async () => {
    await open();
    await answer([]);

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('No application');
    http.verify();
  });

  it('reports a failed read and retries it on request', async () => {
    await open();
    http
      .expectOne('/configuration/api/applications')
      .flush({ message: 'nope' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(page().querySelector('app-async')?.textContent).toContain('503 nope');
    expect(page().querySelector('table')).toBeNull();

    page().querySelector<HTMLButtonElement>('app-async button')?.click();
    await settle();
    await answer([summary()]);

    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  /**
   * The scoped form: an operator who arrived from a repository's sidebar wants that repository's
   * configuration, not a list to find it in.
   *
   * The two outcomes are the whole feature — the repository has an application here, or it does
   * not — and the second is what stops the redirect being a guess. Both are asserted against the
   * listing rather than against the name, because the name alone would land on a page for something
   * this service holds nothing for.
   */
  describe('under a repository scope', () => {
    async function openScoped(): Promise<void> {
      configure([provideQitsScope('repository')]);
      harness = await RouterTestingHarness.create('/qits/services/qits-docs');
      await settle();
    }

    it('replaces the address with the scoped repository own page when it has one', async () => {
      await openScoped();
      await answer([summary({ application: 'qits-docs' }), summary({ application: 'qits-ci' })]);

      expect(TestBed.inject(Router).url).toBe('/qits/services/qits-docs/applications/qits-docs');
      // The entries page is now on screen and issuing its own reads; they are not this spec's.
      http.match(() => true);
    });

    it('stays on the list with a note when the repository has no configuration', async () => {
      await openScoped();
      await answer([summary({ application: 'qits-ci' })]);

      expect(TestBed.inject(Router).url).toBe('/qits/services/qits-docs');
      expect(page().textContent).toContain('qits-docs has no configuration of its own here');
      expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
      http.verify();
    });

    it('keeps its links inside the scope', async () => {
      await openScoped();
      await answer([summary({ application: 'qits-ci', envs: [envSummary({ env: 'prod' })] })]);

      expect(page().querySelector('tbody a')?.getAttribute('href')).toBe(
        '/qits/services/qits-docs/applications/qits-ci',
      );
      expect(page().querySelector('tbody .envs a')?.getAttribute('href')).toBe(
        '/qits/services/qits-docs/applications/qits-ci/envs/prod',
      );
      http.verify();
    });
  });
});
