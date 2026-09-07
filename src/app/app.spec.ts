import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';

/**
 * A fixture navigation, not the platform's. `provideQitsNavigationLinks` answers the layout's
 * `QITS_NAVIGATION` from a literal, so the chrome makes no `/main-navigation` request — which is
 * what keeps `http.verify()` honest instead of failing on a call this file never asked for.
 */
const NAV = [
  { label: 'Deployments', href: '/platform-deployments/' },
  { label: 'Configuration', href: '/configuration/' },
] as const;

/**
 * The shell owns one thing — the outlet — so that is what is asserted here, plus the route table
 * putting every door inside the chrome and the deep links landing on the right page.
 *
 * The layout assertion is not ceremony. Every page here is an administrator's, and one accidentally
 * mounted outside `QitsMainLayout` would be a screen that reads a deployment's environment with no
 * way back to anything — invisible on the page itself and a two-character edit away in this table.
 *
 * **What this file asserts about the pages' READS is only that they were made.** It used to name
 * each page's one URL, which worked while a page had one; the env-addressed pages ask the listing
 * which tiers exist and the declarations route what the keys mean before they can draw anything, and
 * pinning that sequence here would mean two files failing every time one page changed its load
 * budget. Each page's own spec is where its requests are named. `http.match` still drains them, so
 * `http.verify()` keeps its teeth: a page that reached for something outside this service would
 * still be caught by the `provideHttpClientTesting` backend refusing it nowhere else.
 */
describe('App', () => {
  let http: HttpTestingController;

  /**
   * Every read the mounted page issued, taken off the queue without naming it.
   *
   * It LOOPS because these pages read in waves: the listing says which tiers an application has and
   * the declarations listing says which version governs, and only then can the entries and the
   * document be asked for. Draining once would leave the second wave outstanding and `http.verify()`
   * would fail on requests this file deliberately does not name.
   */
  async function drain(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      http.match(() => true).forEach((request) => request.flush({}));
    }
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('is an outlet and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('h1')).toBeNull();
    http.verify();
  });

  it('draws the applications listing at the base path, inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/');
    http.expectOne('/configuration/api/applications').flush({ applications: [] });

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelectorAll('nav a')).toHaveLength(NAV.length);
    expect(layout.querySelector('main app-applications-page')).not.toBeNull();
    http.verify();
  });

  it('routes one application to its entries, still inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev');
    await drain();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-entries-page')).not.toBeNull();
    http.verify();
  });

  /**
   * The env-less spelling is the same component and must land in the same place. It is not a
   * redirect — it means "whichever tier this application has" — so a chrome test that only ever
   * visited the addressed form would not notice it falling out of the layout.
   */
  it('routes the env-less entries spelling to the same page, still inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/applications/qits-docs');
    await drain();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-entries-page')).not.toBeNull();
    http.verify();
  });

  it('routes the history segment to the history page', async () => {
    const harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev/history');
    await drain();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('main app-history-page')).not.toBeNull();
    http.verify();
  });

  it('routes the resolved segment to the resolved page', async () => {
    const harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev/resolved');
    await drain();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-resolved-page')).not.toBeNull();
    http.verify();
  });

  it('routes the declarations segment to the declarations page', async () => {
    const harness = await RouterTestingHarness.create('/applications/qits-docs/declarations');
    await drain();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-declarations-page')).not.toBeNull();
    http.verify();
  });

  it('routes the matrix segment to the cross-env matrix page', async () => {
    const harness = await RouterTestingHarness.create('/applications/qits-docs/matrix');
    await drain();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-matrix-page')).not.toBeNull();
    http.verify();
  });

  /**
   * Not `/nothing-here`: one unknown segment is a *project* now, and the listing is the right
   * answer for one. A URL is unknown only once it is a path no scope could carry.
   */
  it('draws an unknown URL as a page, still inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/no/such/page/here');

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-not-found')).not.toBeNull();
    http.verify();
  });
});
