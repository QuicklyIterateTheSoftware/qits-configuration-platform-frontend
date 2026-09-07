import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { Declaration, DeclarationSummary, DeclaredKey } from '../api/dto';
import { routes } from '../app.routes';

const DECLARATIONS = '/configuration/api/applications/qits-docs/declarations';

/** One version's document, at the address a version segment makes. */
function declarationUrl(version: string): string {
  return `${DECLARATIONS}/${version}`;
}

/** A whole content hash, so the tests can tell an abbreviation from the thing it abbreviates. */
const HASH = '9f2c4b7a1d3e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8';

/**
 * A document with a `description:` in it — the attribute the wire does not carry.
 *
 * The indentation and the trailing newline are load-bearing: one test asserts this string comes back
 * out of the page byte for byte, which is what proves the view never re-formats a document whose
 * content hash is taken over exactly these bytes.
 */
const RAW = `keys:
  env.QITS_DOCS_TITLE:
    type: string
    default: qits docs
    description: what the header of every page says
  env.QITS_EVENTS_URL:
    type: serviceAddress
    service: qits-events
    port: 8080
`;

/**
 * What one application declares about itself, one document per version.
 *
 * Four assertions carry this file. **Governing is not the same row as newest**, so every fixture
 * here flags a version other than the first and the settling is asserted against the flag rather
 * than against position. **The address is never rewritten**, because `…/declarations` means
 * "whichever document governs" and a redirect would freeze that question at the day it was first
 * followed. **The document comes back verbatim**, whitespace and all, because its content hash is
 * over those bytes. And **there is no way to write one from here**: the POST is the pipeline's, and
 * the last test in this file is the one that would fail if a form ever appeared.
 */
describe('DeclarationsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const summary = (over: Partial<DeclarationSummary> = {}): DeclarationSummary => ({
    application: 'qits-docs',
    version: '1.4.0',
    deploymentTarget: 'environment',
    contentHash: HASH,
    keys: 2,
    governing: false,
    receivedAt: '2026-08-17T09:12:03Z',
    receivedBy: 'qits-ci',
    ...over,
  });

  const key = (over: Partial<DeclaredKey> = {}): DeclaredKey => ({
    key: 'env.QITS_DOCS_TITLE',
    type: 'string',
    defaultValue: 'qits docs',
    service: null,
    port: null,
    packageType: null,
    packageName: null,
    ...over,
  });

  const declaration = (over: Partial<Declaration> = {}): Declaration => ({
    application: 'qits-docs',
    version: '1.4.0',
    deploymentTarget: 'environment',
    contentHash: HASH,
    governing: true,
    receivedAt: '2026-08-17T09:12:03Z',
    receivedBy: 'qits-ci',
    keys: [key()],
    raw: RAW,
    ...over,
  });

  /**
   * The listing as it usually arrives: newest intake first, and the GOVERNING one second. The two
   * disagreeing is the point — a page that settled on the top row would pass a fixture where they
   * agreed and be wrong in production the first time a rebuild of an older version was posted.
   */
  const LISTING: readonly DeclarationSummary[] = [
    summary({ version: '1.5.0', receivedAt: '2026-08-18T11:00:00Z' }),
    summary({ version: '1.4.0', governing: true }),
  ];

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

  /** Open the page at `url` and answer the version listing. */
  async function arrive(
    url: string,
    summaries: readonly DeclarationSummary[] = LISTING,
  ): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    http.expectOne(DECLARATIONS).flush({ declarations: summaries });
    await settle();
  }

  /**
   * Answer the document read. Expected AFTER the listing in every case, which works for both
   * spellings: with the version in the address the request is already out and waiting, and without
   * it, it is the listing that let it go.
   */
  async function answer(version: string, document: Declaration): Promise<void> {
    http.expectOne(declarationUrl(version)).flush(document);
    await settle();
  }

  /** The ordinary arrival: the address names a version, and that version's document comes back. */
  async function open(document: Declaration = declaration()): Promise<void> {
    await arrive(`/applications/qits-docs/declarations/${document.version}`);
    await answer(document.version, document);
  }

  function listRows(): HTMLElement[] {
    return Array.from(page().querySelectorAll<HTMLElement>('.versions tbody tr'));
  }

  function keyRows(): HTMLElement[] {
    return Array.from(page().querySelectorAll<HTMLElement>('.document tbody tr'));
  }

  it('reads the listing and the version the address names, and nothing else', async () => {
    await open(declaration({ version: '1.5.0', governing: false }));

    expect(page().querySelector('.document h2')?.textContent).toContain('1.5.0');
    expect(listRows()).toHaveLength(2);
    // `arrive` and `answer` would each have failed on any other URL, so the whole load budget of
    // this page is the two requests they consumed.
    http.verify();
  });

  it('marks the governing version rather than leaving it to be worked out from the order', async () => {
    await open();

    expect(listRows()[0].textContent).toContain('1.5.0');
    expect(listRows()[0].querySelector('qits-badge')).toBeNull();
    expect(listRows()[1].querySelector('qits-badge')?.textContent).toContain('governing');
    http.verify();
  });

  it('settles on the governing version when the address names none, and leaves the URL alone', async () => {
    await arrive('/applications/qits-docs/declarations');
    // 1.4.0 and not 1.5.0: the flag decides, not the position.
    await answer('1.4.0', declaration());

    expect(TestBed.inject(Router).url).toBe('/applications/qits-docs/declarations');
    expect(page().querySelector('.document h2')?.textContent).toContain('1.4.0');
    http.verify();
  });

  it('draws every declared type with the detail that type carries', async () => {
    await open(
      declaration({
        keys: [
          key({ key: 'env.QITS_DOCS_TITLE', type: 'string', defaultValue: 'qits docs' }),
          key({ key: 'env.QITS_DOCS_DEBUG', type: 'boolean', defaultValue: 'false' }),
          key({ key: 'env.QITS_DOCS_PORT', type: 'number', defaultValue: '8080' }),
          key({
            key: 'env.QITS_EVENTS_URL',
            type: 'serviceAddress',
            defaultValue: null,
            service: 'qits-events',
            port: 8080,
          }),
          key({
            key: 'env.QITS_UI_VERSION',
            type: 'packageVersion',
            defaultValue: null,
            packageType: 'npm',
            packageName: '@qits/ui-components',
          }),
        ],
      }),
    );

    const rows = keyRows();
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain('string');
    expect(rows[0].textContent).toContain('qits docs');
    expect(rows[1].textContent).toContain('boolean');
    expect(rows[2].textContent).toContain('number');
    // The two platform types are the only ones with anything to add, and what they add is where the
    // value will come from rather than what it is.
    expect(rows[3].textContent).toContain('serviceAddress');
    expect(rows[3].textContent).toContain('qits-events:8080');
    expect(rows[4].textContent).toContain('packageVersion');
    expect(rows[4].textContent).toContain('npm @qits/ui-components');
    http.verify();
  });

  it('tells a key with no default apart from one whose default is empty', async () => {
    await open(
      declaration({
        keys: [
          key({ key: 'env.QITS_EVENTS_URL', type: 'serviceAddress', defaultValue: null }),
          key({ key: 'env.QITS_DOCS_BANNER', type: 'string', defaultValue: '' }),
        ],
      }),
    );

    const rows = keyRows();
    // No default at all: the key is ABSENT from the resolved map unless something stores it, which
    // is a different thing from a variable set to nothing — and the two must not draw the same.
    expect(rows[0].querySelector('td.value')?.textContent?.trim()).toBe('—');
    expect(rows[1].querySelector('td.value')?.textContent?.trim()).toBe('(empty)');
    expect(page().querySelector('.document caption')?.textContent).toContain(
      'ABSENT from the resolved map',
    );
    http.verify();
  });

  it('draws the document verbatim, whitespace and all', async () => {
    await open();

    // Byte for byte, because the content hash is taken over exactly these bytes: a view that
    // re-indented or re-wrapped would be showing a document that hashes to something else.
    expect(page().querySelector('pre.raw')?.textContent).toBe(RAW);
    http.verify();
  });

  it('says the description is not on the parsed wire and points at the document for it', async () => {
    await open();

    const note = page().querySelector('.document .note')?.textContent ?? '';
    expect(note).toContain('description:');
    expect(note).toContain('no field of its own');
    // The descriptions themselves are readable because the document is on the page.
    expect(page().querySelector('pre.raw')?.textContent).toContain(
      'description: what the header of every page says',
    );
    http.verify();
  });

  it('abbreviates the hash in the listing and gives it whole beside the document', async () => {
    await open();

    expect(listRows()[1].textContent).toContain('9f2c4b7a1d3e…');
    expect(listRows()[1].textContent).not.toContain(HASH);
    expect(page().querySelector('.versions caption')?.textContent).toContain('never the whole');
    expect(page().querySelector('.hash')?.textContent?.trim()).toBe(HASH);
    http.verify();
  });

  it('keeps the version list standing when the document read fails', async () => {
    await arrive('/applications/qits-docs/declarations/9.9.9');
    http
      .expectOne(declarationUrl('9.9.9'))
      .flush({ message: 'no such declaration' }, { status: 404, statusText: 'Not Found' });
    await settle();

    // A stale link is exactly when a reader needs the list of versions that DO exist.
    expect(listRows()).toHaveLength(2);
    expect(page().querySelector('.document app-async')?.textContent).toContain(
      '404 no such declaration',
    );
    expect(page().querySelector('pre.raw')).toBeNull();
    http.verify();
  });

  it('says the application has declared nothing rather than drawing an empty table', async () => {
    await arrive('/applications/qits-docs/declarations', []);

    expect(page().querySelector('.versions table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('declared nothing');
    // Nothing to settle on means nothing to read: no document request was made.
    expect(page().querySelector('.document')).toBeNull();
    http.verify();
  });

  it('offers the way back to the listing and to the application’s entries', async () => {
    await open();

    const crumbs = Array.from(page().querySelectorAll('.crumbs a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(crumbs).toEqual(['/', '/applications/qits-docs']);
    expect(page().querySelector('.entries-link')?.getAttribute('href')).toBe(
      '/applications/qits-docs',
    );
    http.verify();
  });

  it('offers no way to write a declaration, and says why', async () => {
    await open();

    // The POST and the DELETE are the pipeline's and are machine-guarded: a browser cannot honestly
    // assert what a build declared. This is the test that fails if a form ever appears here.
    expect(page().querySelectorAll('form, input, textarea, select')).toHaveLength(0);
    expect(page().querySelector('.posture')?.textContent).toContain('read-only');
    http.verify();
  });

  it('reports a failed listing and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/applications/qits-docs/declarations');
    await settle();
    http
      .expectOne(DECLARATIONS)
      .flush({ message: 'nope' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(page().querySelector('.versions app-async')?.textContent).toContain('503 nope');

    page().querySelector<HTMLButtonElement>('.versions app-async button')?.click();
    await settle();
    http.expectOne(DECLARATIONS).flush({ declarations: LISTING });
    await settle();
    await answer('1.4.0', declaration());

    expect(listRows()).toHaveLength(2);
    http.verify();
  });
});
