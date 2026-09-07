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
const ENTRIES = '/configuration/api/applications/qits-docs/envs/dev/entries';
const RESOLVED = '/configuration/api/applications/qits-docs/envs/dev/resolved';
const EXTRAS = 'qits.platform.deployments.extras.qits-docs.';

/** The one thing on this page an operator most needs to trust, and the one the wire does not say. */
const DECLARED: readonly DeclaredKey[] = [
  {
    key: 'env.QITS_EVENTS_URL',
    type: 'serviceAddress',
    defaultValue: null,
    service: 'qits-events',
    port: 8080,
    packageType: null,
    packageName: null,
  },
  {
    key: 'env.QITS_LOG_LEVEL',
    type: 'string',
    defaultValue: 'INFO',
    service: null,
    port: null,
    packageType: null,
    packageName: null,
  },
  {
    key: 'env.QITS_REGISTRY',
    type: 'string',
    defaultValue: 'registry.localhost',
    service: null,
    port: null,
    packageType: null,
    packageName: null,
  },
  {
    key: 'env.QITS_SEED',
    type: 'string',
    defaultValue: null,
    service: null,
    port: null,
    packageType: null,
    packageName: null,
  },
];

/**
 * The merged map, state by state, and every claim here is one this page could make falsely while
 * looking entirely normal.
 *
 * - **The source of each row is DERIVED, and the derivation has to mirror the service's own
 *   precedence.** A screen that called a rendered address an operator's override, or a default an
 *   override, would be a screen an argument about a misbehaving deployment is settled with — wrongly.
 *   The serviceAddress key below deliberately also carries a stored row, because that is the case
 *   where the client's answer and the naive one differ.
 * - **The picker says "newest" and never claims an environment is running a version.** That fact is
 *   recorded at a deployment's cutover and lives with the deployer; this service does not hold it,
 *   so no word on this page may imply it.
 * - **The version is in the address**, so the screen a reader is looking at is the screen they can
 *   send. A picker that moved only component state would have two operators comparing notes about
 *   one URL and two different answers.
 * - **An empty map is an application nobody has configured**, at revision 0, and never a 404 — a
 *   reader who took it for a missing application would go looking for the wrong bug.
 * - **A 422 is an answer this read can give**, and the service's own sentence about it is what a
 *   reader needs. It is drawn where the table would be, with the heading still above it.
 * - **There is no way to write.** The entries are system state and every process that sets one has
 *   more to do afterwards.
 */
describe('ResolvedPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let methods: string[];

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

  const ENTRY_BODIES = [
    entry(),
    entry({ key: 'env.QITS_SEED', value: 'seeded', entryClass: 'imported', revision: 12 }),
    // A stored row on a key the platform renders. The service reports it orphaned and ignores it;
    // the badge on this row must say so rather than repeating the row's own class.
    entry({
      key: 'env.QITS_EVENTS_URL',
      value: 'http://somebody-typed-this:8080',
      orphaned: true,
      revision: 9,
    }),
  ];

  const RESOLVED_BODY = {
    headRevision: 41,
    properties: {
      [`${EXTRAS}env.QITS_LOG_LEVEL`]: 'INFO',
      [`${EXTRAS}env.QITS_EVENTS_URL`]: 'http://qits-events:8080',
      [`${EXTRAS}env.QITS_REGISTRY`]: 'registry.dev.localhost:8080',
      [`${EXTRAS}env.QITS_SEED`]: 'seeded',
    },
  };

  const summary = (version: string, governing: boolean) => ({
    application: 'qits-docs',
    version,
    deploymentTarget: 'environment',
    contentHash: 'sha256:' + version,
    keys: DECLARED.length,
    governing,
    receivedAt: '2026-09-01T08:00:00Z',
    receivedBy: 'qits-ci',
  });

  const declaration = (version: string) => ({
    application: 'qits-docs',
    version,
    deploymentTarget: 'environment',
    contentHash: 'sha256:' + version,
    governing: version === '1.4.0',
    receivedAt: '2026-09-01T08:00:00Z',
    receivedBy: 'qits-ci',
    keys: DECLARED,
    raw: 'version: ' + version,
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
    const host = page().querySelector<HTMLElement>('app-resolved-page');
    expect(host, 'the page did not render').toBeTruthy();
    return host as HTMLElement;
  }

  /**
   * Answer one request and remember how it was made. The method is kept because "this application
   * never writes" is a claim about the requests and not only about the buttons.
   */
  function answer(url: string, body: object, options?: { status: number; statusText: string }) {
    const request = http.expectOne(url);
    methods.push(request.request.method);
    request.flush(body, options);
  }

  /** A button by the words on it — the way an operator finds it. */
  function press(label: string): void {
    const button = Array.from(view().querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button, `no button labelled “${label}”`).toBeTruthy();
    button?.click();
  }

  /** The three reads that do not depend on which version is being asked about. */
  function wave1(over: { entries?: readonly ConfigurationEntry[]; declarations?: unknown[] } = {}) {
    answer(APPLICATIONS, {
      applications: [
        {
          application: 'qits-docs',
          envs: [
            { env: 'dev', entries: 3, headRevision: 41 },
            { env: 'prod', entries: 1, headRevision: 12 },
          ],
        },
      ],
    });
    answer(DECLARATIONS, {
      declarations: over.declarations ?? [summary('1.4.0', true), summary('1.3.0', false)],
    });
    answer(ENTRIES, { entries: over.entries ?? ENTRY_BODIES });
  }

  /** The two that do. */
  function wave2(version = '1.4.0', resolved: object = RESOLVED_BODY) {
    answer(`${RESOLVED}?version=${version}`, resolved);
    answer(`${DECLARATIONS}/${version}`, declaration(version));
  }

  async function open(url = '/applications/qits-docs/envs/dev/resolved'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    wave1();
    await settle();
    wave2();
    await settle();
  }

  /** One row of the table, by the key in its row header. */
  function row(key: string): HTMLElement {
    const found = Array.from(view().querySelectorAll<HTMLElement>('tbody tr')).find(
      (candidate) => candidate.querySelector('th')?.textContent?.trim() === key,
    );
    expect(found, `no row for ${key}`).toBeTruthy();
    return found as HTMLElement;
  }

  it('makes five reads in two waves, and the second wave carries the version', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev/resolved');
    await settle();
    // Nothing version-dependent has been asked for yet: the declarations listing is what names the
    // version when the address does not, so firing before it would be firing against a guess.
    http.expectNone(`${RESOLVED}?version=1.4.0`);
    wave1();
    await settle();
    wave2();
    await settle();

    expect(methods).toEqual(['GET', 'GET', 'GET', 'GET', 'GET']);
    http.verify();
  });

  it('draws the bare key rather than the property name the deployer layers', async () => {
    await open();

    expect(row('env.QITS_REGISTRY')).toBeTruthy();
    expect(view().querySelector('tbody')?.textContent).not.toContain(EXTRAS);
    http.verify();
  });

  it('works out each row’s source from the entries and the declaration', async () => {
    await open();

    // A stored row a person wrote, over a declared default.
    expect(row('env.QITS_REGISTRY').textContent).toContain('operator');
    expect(row('env.QITS_REGISTRY').textContent).toContain('registry.dev.localhost:8080');
    // A stored row the bootstrap import wrote — same precedence, different hand.
    expect(row('env.QITS_SEED').textContent).toContain('imported');
    // No stored row at all: the declaration's own default.
    expect(row('env.QITS_LOG_LEVEL').textContent).toContain('default');
    expect(row('env.QITS_LOG_LEVEL').textContent).toContain('INFO');
    http.verify();
  });

  it('says a serviceAddress is a rendered address even where somebody stored a row on it', async () => {
    await open();

    // The naive answer is this row's own class, `plain`, and it would be wrong: the platform renders
    // this address and the stored row is ignored in favour of it, which is why the entries read
    // reports that row orphaned.
    const rendered = row('env.QITS_EVENTS_URL');
    expect(rendered.textContent).toContain('rendered address');
    expect(rendered.textContent).not.toContain('operator');
    expect(rendered.textContent).toContain('http://qits-events:8080');
    expect(rendered.textContent).not.toContain('somebody-typed-this');
    http.verify();
  });

  it('draws a property neither read accounts for as unexplained rather than hiding it', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev/resolved');
    await settle();
    wave1();
    await settle();
    wave2('1.4.0', {
      headRevision: 41,
      properties: { [`${EXTRAS}env.QITS_MYSTERY`]: 'from nowhere' },
    });
    await settle();

    expect(row('env.QITS_MYSTERY').textContent).toContain('unexplained');
    http.verify();
  });

  it('defaults to the newest declaration and calls it newest, never deployed, live or current', async () => {
    await open();

    const versions = view().querySelector('.versions');
    expect(versions?.textContent).toContain('1.4.0 — newest');
    // Scoped to the whole page rather than to the picker: the caveat, the lede and the notes are all
    // places a claim about what an environment is running could creep back in.
    expect(view().textContent ?? '').not.toMatch(/deployed|\blive\b|\bcurrent/i);
    http.verify();
  });

  it('says plainly that the newest declaration is not what an environment is running', async () => {
    await open();

    const caveat = view().querySelector('.caveat')?.textContent ?? '';
    expect(caveat).toContain('cutover');
    expect(caveat).toContain('never what is running');
    http.verify();
  });

  it('reads the version out of the address, so a sent link answers what the sender saw', async () => {
    harness = await RouterTestingHarness.create(
      '/applications/qits-docs/envs/dev/resolved?version=1.3.0',
    );
    await settle();
    wave1();
    await settle();
    wave2('1.3.0');
    await settle();

    expect(view().querySelector('.versions')?.textContent).toContain('1.3.0');
    http.verify();
  });

  it('picks a version by navigating, and the address is what re-reads', async () => {
    await open();

    // Clearing is the version-less read — the answer the deployer asks for today — and it is an
    // address of its own rather than a state that evaporates on reload.
    view().querySelector<HTMLButtonElement>('.qits-picker-clear')?.click();
    await settle();
    // No declaration read goes with it: the service is not being asked about declarations, so there
    // is no document whose defaults could explain a row.
    answer(RESOLVED, { headRevision: 41, properties: RESOLVED_BODY.properties });
    await settle();

    // …and picking a version from the list that reopens puts it back in the address.
    const option = Array.from(view().querySelectorAll<HTMLElement>('.qits-picker-option')).find(
      (candidate) => candidate.textContent?.includes('1.3.0'),
    );
    expect(option, 'the version list did not reopen').toBeTruthy();
    option?.click();
    await settle();
    wave2('1.3.0');
    await settle();

    expect(view().querySelector('.versions')?.textContent).toContain('1.3.0');
    http.verify();
  });

  it('carries the version across a hop to another environment', async () => {
    harness = await RouterTestingHarness.create(
      '/applications/qits-docs/envs/dev/resolved?version=1.3.0',
    );
    await settle();
    wave1();
    await settle();
    wave2('1.3.0');
    await settle();

    const hop = Array.from(view().querySelectorAll<HTMLAnchorElement>('.env-list a')).find(
      (candidate) => candidate.textContent?.trim() === 'prod',
    );
    expect(hop?.getAttribute('href')).toBe(
      '/applications/qits-docs/envs/prod/resolved?version=1.3.0',
    );
    http.verify();
  });

  it('says what the head revision is, scoped to this environment', async () => {
    await open();

    const revision = view().querySelector('.revision')?.textContent ?? '';
    expect(revision).toContain('41');
    expect(revision).toContain('never moves backwards');
    expect(revision).toContain('dev');
    http.verify();
  });

  it('says an empty map is an unconfigured application at revision 0, not a missing one', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev/resolved');
    await settle();
    wave1({ entries: [] });
    await settle();
    wave2('1.4.0', { headRevision: 0, properties: {} });
    await settle();

    expect(view().querySelector('table')).toBeNull();
    const empty = view().querySelector('app-empty')?.textContent ?? '';
    expect(empty).toContain('empty map at revision 0');
    expect(empty).toContain('rather than a missing application');
    http.verify();
  });

  it('draws the service’s 422 where the table would be, and retries from there', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/envs/dev/resolved');
    await settle();
    wave1();
    await settle();
    // The service refuses to render an address whose target has never declared its plane, because
    // either alias would be syntactically fine and the wrong one is a container dialling the void.
    answer(
      `${RESOLVED}?version=1.4.0`,
      {
        message:
          'Key env.QITS_EVENTS_URL of application qits-docs addresses qits-events, which has not' +
          ' declared its deployment plane.',
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    answer(`${DECLARATIONS}/1.4.0`, declaration('1.4.0'));
    await settle();

    const error = view().querySelector('.async-error')?.textContent ?? '';
    expect(error).toContain('Could not resolve this configuration');
    expect(error).toContain('422');
    expect(error).toContain('has not declared its deployment plane');
    // The page around the failure stays: heading, breadcrumb and caveat are not the read that failed.
    expect(view().querySelector('h1')?.textContent).toContain('qits-docs');
    expect(view().querySelector('.caveat')).not.toBeNull();

    press('Retry');
    await settle();
    wave2();
    await settle();

    expect(view().querySelectorAll('tbody tr')).toHaveLength(4);
    http.verify();
  });

  it('offers no way to write: no form, no field, and nothing but GETs', async () => {
    await open();

    expect(view().querySelector('form')).toBeNull();
    expect(view().querySelector('input')).toBeNull();
    expect(view().querySelector('textarea')).toBeNull();
    expect(methods).toEqual(methods.map(() => 'GET'));
    http.verify();
  });
});
