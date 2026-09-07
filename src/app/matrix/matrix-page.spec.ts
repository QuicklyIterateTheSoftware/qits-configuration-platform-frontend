import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { ConfigurationEntry, DeclaredKey } from '../api/dto';
import { routes } from '../app.routes';

const APPLICATIONS = '/configuration/api/applications';
const DECLARATIONS = '/configuration/api/applications/qits-docs/declarations';
const ENTRIES_DEV = '/configuration/api/applications/qits-docs/envs/dev/entries';
const ENTRIES_PROD = '/configuration/api/applications/qits-docs/envs/prod/entries';

const declaredKey = (over: Partial<DeclaredKey> & { key: string }): DeclaredKey => ({
  type: 'string',
  defaultValue: null,
  service: null,
  port: null,
  packageType: null,
  packageName: null,
  ...over,
});

/**
 * The declaration the defaults come from — one key of each shape the grid has to draw differently.
 *
 * `env.QITS_THEME` is the one stored in no environment at all: it exists only because the
 * declaration names it, and a grid that left it out would be a grid claiming the key does not exist
 * while every container receives it.
 */
const DECLARED: readonly DeclaredKey[] = [
  declaredKey({
    key: 'env.QITS_EVENTS_URL',
    type: 'serviceAddress',
    service: 'qits-events',
    port: 8080,
  }),
  declaredKey({ key: 'env.QITS_LOG_LEVEL', defaultValue: 'INFO' }),
  declaredKey({ key: 'env.QITS_SEED' }),
  declaredKey({ key: 'env.QITS_THEME', defaultValue: 'dark' }),
];

/**
 * The grid, and every claim it makes about a tier it did not read.
 *
 * - **One request per environment, and the page says so rather than hiding it.** There is no route
 *   that answers several tiers at once; asking one at a time in a browser tab per environment is
 *   what this screen exists to stop somebody doing by hand.
 * - **Each cell says which of five things it is**, in `ui/source.ts`'s own words, so this page and
 *   the resolved page cannot drift apart about a fact they both derive. Absent is this page's fifth
 *   state and is drawn as ordinary rather than as the alarm `sourceOf` reserves for a resolved map.
 * - **A serviceAddress cell is not an operator's, even where a row is stored on it.** The platform
 *   renders that address and the stored row is ignored in favour of it.
 * - **Divergence is defined on what a container would receive**, absent counts as its own answer,
 *   and it is never drawn as a fault: tiers are supposed to differ.
 * - **The defaults are the newest declaration's**, which is not a claim about what any tier is
 *   running — that is recorded at a deployment's cutover and this service does not hold it.
 * - **There is no way to write.**
 */
describe('MatrixPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let methods: string[];

  const entry = (over: Partial<ConfigurationEntry> & { key: string }): ConfigurationEntry => ({
    env: 'dev',
    application: 'qits-docs',
    value: '',
    entryClass: 'plain',
    orphaned: false,
    revision: 7,
    updatedAt: '2026-08-17T09:12:03Z',
    updatedBy: 'wohlben',
    ...over,
  });

  const DEV_ENTRIES: readonly ConfigurationEntry[] = [
    // An operator's override of a declared default — and prod has no row, so this key diverges.
    entry({ key: 'env.QITS_LOG_LEVEL', value: 'DEBUG' }),
    // The bootstrap import's value on a declared key with no default — absent in prod, which is a
    // divergence of the most useful kind: "set in dev, nothing in prod".
    entry({ key: 'env.QITS_SEED', value: 'seeded', entryClass: 'imported' }),
    // A stored row on a key the platform renders. Reported orphaned, ignored for the value.
    entry({ key: 'env.QITS_EVENTS_URL', value: 'http://somebody-typed-this:8080', orphaned: true }),
    // A key no declaration accounts for, holding the same string in both tiers.
    entry({ key: 'env.QITS_EXTRA', value: 'same', orphaned: true }),
  ];

  const PROD_ENTRIES: readonly ConfigurationEntry[] = [
    entry({ env: 'prod', key: 'env.QITS_EXTRA', value: 'same', orphaned: true }),
  ];

  const GOVERNING = {
    application: 'qits-docs',
    version: '1.4.0',
    deploymentTarget: 'environment',
    contentHash: 'sha256:1.4.0',
    keys: DECLARED.length,
    governing: true,
    receivedAt: '2026-09-01T08:00:00Z',
    receivedBy: 'qits-ci',
  };

  const DECLARATION = {
    ...GOVERNING,
    keys: DECLARED,
    raw: 'version: 1.4.0',
  };

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
    methods = [];
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

  function view(): HTMLElement {
    const host = page().querySelector<HTMLElement>('app-matrix-page');
    expect(host, 'the page did not render').toBeTruthy();
    return host as HTMLElement;
  }

  /** Answer one request and remember the method: "never writes" is a claim about the requests too. */
  function answer(url: string, body: object, options?: { status: number; statusText: string }) {
    const request = http.expectOne(url);
    methods.push(request.request.method);
    request.flush(body, options);
  }

  function press(label: string): void {
    const button = Array.from(view().querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button, `no button labelled “${label}”`).toBeTruthy();
    button?.click();
  }

  /** The two listings that say what shape the grid is: its columns, and its declaration. */
  function wave1(envs = ['dev', 'prod'], declarations: unknown[] = [GOVERNING]) {
    answer(APPLICATIONS, {
      applications: [
        {
          application: 'qits-docs',
          envs: envs.map((env) => ({ env, entries: 4, headRevision: 41 })),
        },
      ],
    });
    answer(DECLARATIONS, { declarations });
  }

  /** One entries read per environment, plus the declaration. */
  function wave2() {
    answer(ENTRIES_DEV, { entries: DEV_ENTRIES });
    answer(ENTRIES_PROD, { entries: PROD_ENTRIES });
    answer(`${DECLARATIONS}/1.4.0`, DECLARATION);
  }

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/applications/qits-docs/matrix');
    await settle();
    wave1();
    await settle();
    wave2();
    await settle();
  }

  /** One row by the key in its header, and one cell of it by column index. */
  function row(key: string): HTMLElement {
    const found = Array.from(view().querySelectorAll<HTMLElement>('tbody tr')).find(
      (candidate) => candidate.querySelector('.key-name')?.textContent?.trim() === key,
    );
    expect(found, `no row for ${key}`).toBeTruthy();
    return found as HTMLElement;
  }

  function cell(key: string, column: number): HTMLElement {
    return row(key).querySelectorAll<HTMLElement>('td')[column];
  }

  it('asks each environment for its entries once, in one wave, and nothing per row', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/matrix');
    await settle();
    // The environments it will ask are named by the applications listing, so nothing per-env can be
    // in flight before that listing answers.
    http.expectNone(ENTRIES_DEV);
    wave1();
    await settle();
    wave2();
    await settle();

    expect(methods).toEqual(['GET', 'GET', 'GET', 'GET', 'GET']);
    expect(view().querySelectorAll('thead th')).toHaveLength(3);
    http.verify();
  });

  it('draws one column per environment, each linking to that tier’s entries', async () => {
    await open();

    const columns = Array.from(view().querySelectorAll<HTMLAnchorElement>('thead a'));
    expect(columns.map((column) => column.textContent?.trim())).toEqual(['dev', 'prod']);
    expect(columns[1].getAttribute('href')).toBe('/applications/qits-docs/envs/prod');
    http.verify();
  });

  it('says which of the five states each cell is in', async () => {
    await open();

    // An operator's override in dev; the declared default standing in for prod.
    expect(cell('env.QITS_LOG_LEVEL', 0).textContent).toContain('DEBUG');
    expect(cell('env.QITS_LOG_LEVEL', 0).textContent).toContain('operator');
    expect(cell('env.QITS_LOG_LEVEL', 1).textContent).toContain('INFO');
    expect(cell('env.QITS_LOG_LEVEL', 1).textContent).toContain('default');

    // The bootstrap import's value in dev; nothing at all in prod, which is not an empty value.
    expect(cell('env.QITS_SEED', 0).textContent).toContain('imported');
    expect(cell('env.QITS_SEED', 1).textContent).toContain('absent');
    expect(cell('env.QITS_SEED', 1).textContent).toContain('not set');
    // Absent is ordinary here and must not be drawn as the alarm `sourceOf` reserves for a resolved
    // map that holds a key nothing accounts for.
    expect(cell('env.QITS_SEED', 1).textContent).not.toContain('unexplained');

    http.verify();
  });

  it('draws a serviceAddress as the platform’s own, even where a row is stored on it', async () => {
    await open();

    const rendered = cell('env.QITS_EVENTS_URL', 0);
    expect(rendered.textContent).toContain('rendered address');
    expect(rendered.textContent).not.toContain('operator');
    expect(rendered.textContent).not.toContain('somebody-typed-this');
    // What the declaration knows: the service and the port. The host half depends on which plane
    // qits-events deploys onto and exists only in a resolved read for one environment.
    expect(rendered.textContent).toContain('qits-events:8080');
    http.verify();
  });

  it('marks a row whose tiers differ and leaves a uniform row unmarked', async () => {
    await open();

    // Different strings in the two tiers.
    expect(row('env.QITS_LOG_LEVEL').className).toContain('diverges');
    expect(row('env.QITS_LOG_LEVEL').textContent).toContain('differs');
    // Set in dev, absent in prod — a difference in what a container receives, so it counts.
    expect(row('env.QITS_SEED').className).toContain('diverges');
    // The same string in both, however each tier got it.
    expect(row('env.QITS_EXTRA').className).not.toContain('diverges');
    expect(row('env.QITS_EXTRA').textContent).not.toContain('differs');
    // One declaration renders this in every tier, so it is uniform by construction.
    expect(row('env.QITS_EVENTS_URL').className).not.toContain('diverges');
    http.verify();
  });

  it('does not colour divergence as a fault, and says so in the caption', async () => {
    await open();

    const caption = view().querySelector('caption')?.textContent ?? '';
    expect(caption).toContain('never an error in itself');
    http.verify();
  });

  it('draws a key declared and stored nowhere as the default in every environment', async () => {
    await open();

    expect(cell('env.QITS_THEME', 0).textContent).toContain('dark');
    expect(cell('env.QITS_THEME', 0).textContent).toContain('default');
    expect(cell('env.QITS_THEME', 1).textContent).toContain('dark');
    expect(row('env.QITS_THEME').className).not.toContain('diverges');
    http.verify();
  });

  it('says a stored key the declaration does not account for is not declared', async () => {
    await open();

    expect(row('env.QITS_EXTRA').textContent).toContain('not declared');
    expect(cell('env.QITS_EXTRA', 0).textContent).toContain('operator');
    http.verify();
  });

  it('names the declaration its defaults came from and refuses to call it deployed', async () => {
    await open();

    const caveat = view().querySelector('.caveat')?.textContent ?? '';
    expect(caveat).toContain('1.4.0');
    expect(caveat).toContain('newest');
    expect(caveat).toContain('cutover');
    expect(view().textContent ?? '').not.toMatch(/deployed|\blive\b|\bcurrent/i);
    http.verify();
  });

  it('says plainly when an application has declared nothing', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/matrix');
    await settle();
    wave1(['dev', 'prod'], []);
    await settle();
    // No declaration to read: nothing names one.
    answer(ENTRIES_DEV, { entries: DEV_ENTRIES });
    answer(ENTRIES_PROD, { entries: PROD_ENTRIES });
    await settle();

    expect(view().querySelector('.caveat')?.textContent).toContain('declared nothing');
    // Every remaining row is a stored one, so the grid is the entries and nothing else.
    // …and `env.QITS_THEME`, which exists only in the declaration, is not among them.
    expect(view().querySelectorAll('tbody tr')).toHaveLength(4);
    expect(view().querySelector('tbody')?.textContent).not.toContain('env.QITS_THEME');
    http.verify();
  });

  it('fails the whole grid when one environment fails, rather than drawing a missing column', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/matrix');
    await settle();
    wave1();
    await settle();
    answer(ENTRIES_DEV, { entries: DEV_ENTRIES });
    answer(
      ENTRIES_PROD,
      { message: 'the store is down' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    answer(`${DECLARATIONS}/1.4.0`, DECLARATION);
    await settle();

    // A grid missing prod while looking complete would read as "prod has none of these keys", which
    // is the worst sentence this page could accidentally say.
    expect(view().querySelector('table')).toBeNull();
    const error = view().querySelector('.async-error')?.textContent ?? '';
    expect(error).toContain('Could not build the matrix');
    expect(error).toContain('503 the store is down');
    expect(view().querySelector('h1')?.textContent).toContain('qits-docs');

    press('Retry');
    await settle();
    wave2();
    await settle();

    expect(view().querySelectorAll('tbody tr')).toHaveLength(5);
    http.verify();
  });

  it('says an application with no environments has no columns to compare', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/matrix');
    await settle();
    wave1([], []);
    await settle();

    expect(view().querySelector('table')).toBeNull();
    expect(view().querySelector('app-empty')?.textContent).toContain('no columns to compare');
    http.verify();
  });

  it('offers no way to write: no form, no field, no button, and nothing but GETs', async () => {
    await open();

    expect(view().querySelector('form')).toBeNull();
    expect(view().querySelector('input')).toBeNull();
    expect(view().querySelector('textarea')).toBeNull();
    expect(view().querySelectorAll('button')).toHaveLength(0);
    expect(methods).toEqual(methods.map(() => 'GET'));
    http.verify();
  });
});
