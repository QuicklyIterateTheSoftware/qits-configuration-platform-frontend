import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type {
  ApplicationEnvSummary,
  ConfigurationEntry,
  Declaration,
  DeclarationSummary,
  DeclaredKey,
} from '../api/dto';
import { routes } from '../app.routes';

const LISTING = '/configuration/api/applications';

function entriesUrl(env: string, application = 'qits-docs'): string {
  return `${LISTING}/${application}/envs/${env}/entries`;
}

function declarationsUrl(application = 'qits-docs'): string {
  return `${LISTING}/${application}/declarations`;
}

function declarationUrl(version: string, application = 'qits-docs'): string {
  return `${declarationsUrl(application)}/${version}`;
}

/** A value longer than any table cell wants to be — the ordinary case on this screen. */
const LONG_VALUE =
  '/srv/platform/docs/a-very-long-host-path-that-nobody-would-choose-by-hand:' +
  '/work/docs/an-equally-long-container-path:ro';

/**
 * The table, state by state, now that a table has an ENVIRONMENT.
 *
 * What each test here guards, and the way this page could be quietly wrong without it:
 *
 * - **a value is never truncated.** The whole point of the screen is reading what a deployment will
 *   carry, and a cell that clipped at some width would say something false about it while looking
 *   entirely normal.
 * - **the page offers no way to write.** The entries are system state and the platform's own
 *   processes set them; a control that wrote one from here would land in the middle of an operation
 *   with more to do afterwards.
 * - **it says so, in a sentence.** A table with no buttons otherwise reads as a table whose buttons
 *   failed to load — and now that there IS a control on the page, the sentence has to say what that
 *   control does.
 * - **the env-less address settles rather than redirects.** `applications/<app>` means "whichever
 *   tier this application has"; the page answers it and leaves the URL alone.
 * - **a row says what it is.** A declared type, an orphan marker, a `serviceAddress` the platform
 *   renders anyway — three different reasons a value on this screen is not the value the container
 *   gets, and all three are invisible without the declaration read.
 * - **a failed declaration read still draws the table.** Types are an improvement to the table, not
 *   a precondition for it.
 * - **a failed read is a failed read, with a way back.** The error is drawn where the table would
 *   be, and the retry re-issues the request.
 *
 * **Four requests, and the helper below is the assertion.** `scene()` answers exactly the directory,
 * the entries, the declarations listing and the governing document, and every test closes with
 * `http.verify()` — so a fifth read, or a read per row, fails here rather than in a browser.
 */
describe('EntriesPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const envSummary = (over: Partial<ApplicationEnvSummary> = {}): ApplicationEnvSummary => ({
    env: 'dev',
    entries: 3,
    headRevision: 41,
    ...over,
  });

  /** The tiers the listing gives by default: sorted by name, which is what makes dev "first". */
  const TIERS: readonly ApplicationEnvSummary[] = [
    envSummary({ env: 'dev', entries: 3, headRevision: 41 }),
    envSummary({ env: 'prod', entries: 1, headRevision: 44 }),
  ];

  const entry = (over: Partial<ConfigurationEntry> = {}): ConfigurationEntry => ({
    env: 'dev',
    application: 'qits-docs',
    key: 'env.QITS_REGISTRY',
    value: 'registry.dev.localhost:8080',
    entryClass: 'plain',
    orphaned: false,
    revision: 41,
    updatedAt: '2026-08-17T09:12:03Z',
    updatedBy: 'wohlben',
    ...over,
  });

  const declaredKey = (over: Partial<DeclaredKey> = {}): DeclaredKey => ({
    key: 'env.QITS_REGISTRY',
    type: 'string',
    defaultValue: 'registry.localhost:8080',
    service: null,
    port: null,
    packageType: null,
    packageName: null,
    ...over,
  });

  const declarationSummary = (over: Partial<DeclarationSummary> = {}): DeclarationSummary => ({
    application: 'qits-docs',
    version: '1.4.0',
    deploymentTarget: 'platform',
    contentHash: 'sha256:3f1c',
    keys: 1,
    governing: true,
    receivedAt: '2026-08-01T11:00:00Z',
    receivedBy: 'qits-ci',
    ...over,
  });

  const declarationDoc = (
    keys: readonly DeclaredKey[] = [declaredKey()],
    version = '1.4.0',
  ): Declaration => ({
    application: 'qits-docs',
    version,
    deploymentTarget: 'platform',
    contentHash: 'sha256:3f1c',
    governing: true,
    receivedAt: '2026-08-01T11:00:00Z',
    receivedBy: 'qits-ci',
    keys,
    raw: 'configuration:\n  env.QITS_REGISTRY:\n    type: string\n',
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

  /** This page's own host. The chrome around it has controls of its own, and they are not its. */
  function view(): HTMLElement {
    const host = page().querySelector<HTMLElement>('app-entries-page');
    expect(host, 'the entries page is not on screen').toBeTruthy();
    return host as HTMLElement;
  }

  /** A button by the words on it — the way an operator finds it. */
  function press(label: string, within: ParentNode = page()): void {
    const button = Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button, `no button labelled “${label}”`).toBeTruthy();
    button?.click();
  }

  /** How a button announces itself: its own words, or the label it carries for a screen reader. */
  function accessibleName(button: HTMLButtonElement): string {
    const text = button.textContent?.trim() ?? '';
    return text.length > 0 ? text : (button.getAttribute('aria-label') ?? '');
  }

  async function open(url = '/applications/qits-docs'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
  }

  interface Scene {
    readonly application: string;
    /** The tier the entries read is expected on — the settled one where the address names none. */
    readonly env: string;
    readonly envs: readonly ApplicationEnvSummary[];
    readonly entries: readonly ConfigurationEntry[];
    readonly declarations: readonly DeclarationSummary[];
    readonly keys: readonly DeclaredKey[];
  }

  /**
   * The page's four reads, answered.
   *
   * They are flushed in two rounds because two of them cannot be ISSUED until another has answered:
   * the entries read waits for the tier (on the env-less address), and the document read waits for
   * the listing that says which version governs. `expectOne` matches a request whenever it was made,
   * so one helper serves both spellings of the address — on an env-addressed URL the entries read is
   * already outstanding in the first round and is simply answered in the second.
   */
  async function scene(over: Partial<Scene> = {}): Promise<void> {
    const plan: Scene = {
      application: 'qits-docs',
      env: 'dev',
      envs: TIERS,
      entries: [entry()],
      declarations: [declarationSummary()],
      keys: [declaredKey()],
      ...over,
    };

    http
      .expectOne(LISTING)
      .flush({ applications: [{ application: plan.application, envs: plan.envs }] });
    http.expectOne(declarationsUrl(plan.application)).flush({ declarations: plan.declarations });
    await settle();

    http.expectOne(entriesUrl(plan.env, plan.application)).flush({ entries: plan.entries });
    const governing = plan.declarations.find((summary) => summary.governing);
    if (governing) {
      http
        .expectOne(declarationUrl(governing.version, plan.application))
        .flush(declarationDoc(plan.keys, governing.version));
    }
    await settle();
  }

  it('draws one application’s entries for one tier, with key, value and type', async () => {
    await open();
    await scene({ entries: [entry(), entry({ key: 'mounts[0]', value: '/srv:/work:ro' })] });

    const rows = page().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('env.QITS_REGISTRY');
    expect(rows[0].textContent).toContain('registry.dev.localhost:8080');
    expect(rows[0].textContent).toContain('string');
    expect(rows[1].textContent).toContain('mounts[0]');
    expect(page().querySelector('h1')?.textContent).toContain('qits-docs');
    expect(page().querySelector('h1')?.textContent).toContain('dev');
    http.verify();
  });

  it('draws who changed a row and when', async () => {
    await open();
    await scene({ entries: [entry({ updatedBy: 'qits-platform-deployments' })] });

    expect(page().querySelector('.changed')?.textContent).toContain('qits-platform-deployments');
    http.verify();
  });

  it('draws a long value whole, with nothing clipped away', async () => {
    await open();
    await scene({ entries: [entry({ value: LONG_VALUE })] });

    expect(page().querySelector('td.value')?.textContent).toContain(LONG_VALUE);
    http.verify();
  });

  it('draws the empty string as a word rather than as a blank cell', async () => {
    await open();
    await scene({ entries: [entry({ value: '' })] });

    expect(page().querySelector('td.value')?.textContent).toContain('(empty)');
    http.verify();
  });

  /**
   * **This assertion had to change, and what it had to keep is the point of it.**
   *
   * It used to read "no button, no field, no form", counting every button on this page's host and
   * demanding zero. That count is no longer the right test: the page is env-addressed now and the
   * env picker is a legitimate control — it navigates between tiers and writes nothing — so a page
   * that had genuinely regained a write would still fail the count, and a page that had not would
   * fail it too. A count that fails for the right reason and the wrong reason equally is a count
   * that stops being read.
   *
   * So the shape of the claim is what is asserted instead: there is no `form`, no `input` and no
   * `textarea` anywhere on this page — a read-only screen needs none of the three, and every way of
   * writing an entry from a browser needs at least one — and every button that exists BELONGS to a
   * control that cannot write: the picker, which navigates, or the async panel's retry, which
   * re-issues a GET. Both are checked by where the button lives and by the name it announces itself
   * with, so a write button smuggled in beside them is caught by the same test that lets these two
   * through.
   */
  it('offers no way to write: no form, no field, and every button belongs to a reader’s control', async () => {
    await open();
    await scene();

    expect(view().querySelector('form')).toBeNull();
    expect(view().querySelector('input')).toBeNull();
    expect(view().querySelector('textarea')).toBeNull();

    const buttons = Array.from(view().querySelectorAll<HTMLButtonElement>('button'));
    for (const button of buttons) {
      expect(
        button.closest('qits-picker, app-async'),
        `a button outside the picker and the retry: “${accessibleName(button)}”`,
      ).not.toBeNull();
    }
    // And the only one drawn while everything has loaded is the picker's own.
    expect(buttons.map(accessibleName)).toEqual(['Change environment']);
    http.verify();
  });

  it('says the view is read-only, in a sentence that accounts for the picker', async () => {
    await open();
    await scene();

    const posture = page().querySelector('.posture')?.textContent;
    expect(posture).toContain('read-only');
    expect(posture).toContain('navigates');
    http.verify();
  });

  it('says an application with no entries in this tier has none, in a sentence', async () => {
    await open();
    await scene({ entries: [] });

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('no entries in dev');
    http.verify();
  });

  /**
   * Settling, which is the env-less address's whole answer.
   *
   * The listing arrives sorted by env name, the page takes the first tier, and the URL is left
   * exactly as the reader wrote it. A redirect here would be the page overruling a deliberately
   * unspecific address — and would put a step in the history that Back cannot get out of.
   */
  it('settles the env-less address on the first tier without rewriting the URL', async () => {
    await open('/applications/qits-docs');
    await scene({ env: 'dev' });

    expect(TestBed.inject(Router).url).toBe('/applications/qits-docs');
    expect(page().querySelector('h1')?.textContent).toContain('dev');
    expect(page().querySelector('.settled')?.textContent).toContain('names no environment');
    http.verify();
  });

  it('reads the tier the address names, and says nothing about settling', async () => {
    await open('/applications/qits-docs/envs/prod');
    await scene({ env: 'prod' });

    expect(page().querySelector('h1')?.textContent).toContain('prod');
    expect(page().querySelector('.settled')).toBeNull();
    http.verify();
  });

  /**
   * The picker's options are the applications listing, narrowed — there is no other route on the
   * wire that says which tiers an application has, and a page that guessed them from anywhere else
   * would offer a tier that does not exist.
   *
   * The list is reached through the picker's own clear control, which is what "change this" means
   * on a component whose collapsed state IS its answer.
   */
  it('offers the tiers the applications listing gave, with their counts', async () => {
    await open();
    await scene();

    expect(page().querySelector('.qits-picker-value')?.textContent).toContain('dev');

    page().querySelector<HTMLButtonElement>('button[aria-label="Change environment"]')?.click();
    await settle();

    const options = Array.from(page().querySelectorAll('.qits-picker-option')).map((option) =>
      option.textContent?.trim(),
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toContain('dev');
    expect(options[0]).toContain('3 entries');
    expect(options[1]).toContain('prod');
    expect(options[1]).toContain('1 entry');
    http.verify();
  });

  /**
   * Picking a tier navigates, and it PUSHES: the reader took that step, and Back belongs to them.
   *
   * The address it lands on is the addressed spelling of the tier — which is the other half of
   * settling, and the reason the env-less page does not need to rewrite anything: a reader who wants
   * a bookmarkable URL gets one by picking.
   */
  it('navigates to the tier that was picked', async () => {
    await open();
    await scene();

    page().querySelector<HTMLButtonElement>('button[aria-label="Change environment"]')?.click();
    await settle();

    const prod = Array.from(page().querySelectorAll<HTMLElement>('.qits-picker-option')).find(
      (option) => option.textContent?.includes('prod'),
    );
    expect(prod, 'no prod option to pick').toBeTruthy();
    prod?.click();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/applications/qits-docs/envs/prod');
    // The addressed route is a different route, so the page is rebuilt and reads its four again.
    // Those reads are the previous tests' subject and not this one's.
    http.match(() => true);
  });

  it('links to this tier’s resolved view, its history, the declarations and the matrix', async () => {
    await open();
    await scene();

    expect(page().querySelector('.resolved-link')?.getAttribute('href')).toBe(
      '/applications/qits-docs/envs/dev/resolved',
    );
    expect(page().querySelector('.history-link')?.getAttribute('href')).toBe(
      '/applications/qits-docs/envs/dev/history',
    );
    expect(page().querySelector('.declarations-link')?.getAttribute('href')).toBe(
      '/applications/qits-docs/declarations',
    );
    expect(page().querySelector('.matrix-link')?.getAttribute('href')).toBe(
      '/applications/qits-docs/matrix',
    );
    http.verify();
  });

  /**
   * A type is the governing declaration's word about a key, joined on this page and drawn nowhere
   * else. A key the declaration does not spell has none, and the cell says so rather than sitting
   * empty — an empty type cell is indistinguishable from a type that failed to arrive.
   */
  it('badges a declared key with its type, and says when a key is not declared', async () => {
    await open();
    await scene({
      entries: [entry(), entry({ key: 'env.QITS_ANCIENT', orphaned: true })],
      keys: [declaredKey({ key: 'env.QITS_REGISTRY', type: 'string' })],
    });

    const types = page().querySelectorAll('td.type');
    expect(types[0].textContent).toContain('string');
    expect(types[1].textContent).toContain('not declared');
    http.verify();
  });

  /**
   * The orphan marker: computed at read time by the service, drawn here, explained under the table.
   * It is not an error and nothing cleans it up, so the page must not draw it as one.
   */
  it('marks an orphaned row and explains what being orphaned means', async () => {
    await open();
    await scene({ entries: [entry({ key: 'env.QITS_ANCIENT', orphaned: true })], keys: [] });

    expect(page().querySelector('tbody .marks')?.textContent).toContain('orphaned');
    expect(view().textContent).toContain('not reaching the container');
    expect(page().querySelector('.async-error')).toBeNull();
    http.verify();
  });

  /**
   * A `serviceAddress` is the one type an operator may not set: the platform renders the host per
   * environment and the stored row is ignored. A row that looked like every other row until a
   * deployment disagreed with it is exactly the failure this marker exists to prevent.
   */
  it('marks a serviceAddress row as the platform’s, and says what it renders', async () => {
    await open();
    await scene({
      entries: [entry({ key: 'env.QITS_DOCS_URL', value: 'http://stale:1', orphaned: true })],
      keys: [
        declaredKey({
          key: 'env.QITS_DOCS_URL',
          type: 'serviceAddress',
          defaultValue: null,
          service: 'qits-docs',
          port: 8080,
        }),
      ],
    });

    const row = page().querySelector('tbody tr');
    expect(row?.querySelector('td.type')?.textContent).toContain('serviceAddress');
    expect(row?.querySelector('td.type')?.textContent).toContain('platform-rendered');

    const note = row?.querySelector('.rendered-note')?.textContent;
    expect(note).toContain('http://qits-docs:8080');
    expect(note).toContain('http://dev-qits-docs:8080');
    expect(note).toContain('ignored');
    http.verify();
  });

  /**
   * `plain` is the WIRE's word for "somebody set this", and nobody outside the service calls it
   * that. The screen says operator, keeps `imported` as it is, and the wire's own spelling never
   * reaches a reader.
   */
  it('says operator and imported rather than the wire’s own word', async () => {
    await open();
    await scene({
      entries: [
        entry({ key: 'env.QITS_REGISTRY', entryClass: 'plain' }),
        entry({ key: 'env.QITS_SEEDED', entryClass: 'imported' }),
      ],
    });

    const rows = page().querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('operator');
    expect(rows[1].textContent).toContain('imported');
    // Scoped to this page's own host: the wire's word must not reach a reader from anywhere on it.
    expect(view().textContent).not.toContain('plain');
    http.verify();
  });

  /**
   * The two panels are separate `Loadable`s so that this is possible at all: a table with no type
   * badges is strictly better than no table. The keys, the values and who wrote them are what an
   * operator came for, and none of them depend on the declaration.
   */
  it('still draws the table when the declaration cannot be read', async () => {
    await open();

    http.expectOne(LISTING).flush({ applications: [{ application: 'qits-docs', envs: TIERS }] });
    http.expectOne(declarationsUrl()).flush({ declarations: [declarationSummary()] });
    await settle();

    http.expectOne(entriesUrl('dev')).flush({ entries: [entry()] });
    http
      .expectOne(declarationUrl('1.4.0'))
      .flush({ message: 'no such document' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    expect(page().querySelector('tbody tr')?.textContent).toContain('registry.dev.localhost:8080');
    expect(page().querySelector('td.type')?.textContent).toContain('not declared');
    expect(page().querySelector('.async-error')?.textContent).toContain(
      'Could not load the governing declaration',
    );
    http.verify();
  });

  it('asks for no document when the application has declared nothing', async () => {
    await open();
    await scene({ declarations: [] });

    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    expect(page().querySelector('td.type')?.textContent).toContain('not declared');
    expect(page().querySelector('.async-error')).toBeNull();
    http.verify();
  });

  it('draws a failed entries read where the table would be, and retries from there', async () => {
    await open();

    http.expectOne(LISTING).flush({ applications: [{ application: 'qits-docs', envs: TIERS }] });
    http.expectOne(declarationsUrl()).flush({ declarations: [] });
    await settle();

    http
      .expectOne(entriesUrl('dev'))
      .flush({ message: 'the store is down' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    const error = page().querySelector('.async-error');
    expect(error?.textContent).toContain('Could not load the entries');
    expect(error?.textContent).toContain('503 the store is down');
    // The heading, the breadcrumb and the picker stay: a failed panel does not erase the page.
    expect(page().querySelector('h1')?.textContent).toContain('qits-docs');
    expect(page().querySelector('qits-picker')).not.toBeNull();

    press('Retry');
    await settle();
    http.expectOne(entriesUrl('dev')).flush({ entries: [entry()] });
    await settle();

    expect(page().querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('re-reads everything when the route moves to another application', async () => {
    await open();
    await scene();

    await harness.navigateByUrl('/applications/qits-ci');
    await settle();

    await scene({
      application: 'qits-ci',
      envs: [envSummary({ env: 'dev', entries: 1, headRevision: 3 })],
      entries: [entry({ application: 'qits-ci', key: 'env.QITS_CI' })],
      declarations: [],
    });

    expect(page().querySelector('h1')?.textContent).toContain('qits-ci');
    expect(page().querySelector('tbody tr')?.textContent).toContain('env.QITS_CI');
    http.verify();
  });
});
