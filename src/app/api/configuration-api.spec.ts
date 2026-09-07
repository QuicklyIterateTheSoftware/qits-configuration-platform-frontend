import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigurationApi } from './configuration-api';

/**
 * Every read this app makes, at the address qits-configuration serves it at. There are only reads:
 * this app writes nothing.
 *
 * The assertions worth having here are the ones that are invisible on screen when they are wrong:
 * **every path is relative**, because a configured origin would leave the edge's session cookie
 * behind and turn every read into a 401; **every call is a GET**, which is what keeps this class a
 * reader; **the env is in the path**, because a read that silently answered for the wrong tier is
 * the one failure of this service nobody would see; and **a failure reaches the caller whole**,
 * because the page draws the service's own sentence from it.
 *
 * The env-less spellings are the service's transitional routes and are asserted NOWHERE, on purpose:
 * a spec that named one would be the thing keeping it alive after the cutover removes it.
 */
describe('ConfigurationApi', () => {
  let api: ConfigurationApi;
  let http: HttpTestingController;

  const entry = {
    env: 'dev',
    application: 'qits-docs',
    key: 'env.QITS_REGISTRY',
    value: 'registry.dev.localhost:8080',
    entryClass: 'plain',
    orphaned: false,
    revision: 41,
    updatedAt: '2026-08-17T09:12:00Z',
    updatedBy: 'wohlben',
  };

  const declared = {
    key: 'env.QITS_EVENTS_URL',
    type: 'serviceAddress',
    defaultValue: null,
    service: 'qits-events',
    port: 8080,
    packageType: null,
    packageName: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ConfigurationApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists applications at a relative path and unwraps the envelope', async () => {
    const applications = api.applications();

    const request = http.expectOne('/configuration/api/applications');
    expect(request.request.method).toBe('GET');
    request.flush({
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

    expect(await applications).toEqual([
      {
        application: 'qits-docs',
        envs: [
          { env: 'dev', entries: 3, headRevision: 41 },
          { env: 'prod', entries: 1, headRevision: 12 },
        ],
      },
    ]);
  });

  it('reads an envelope with no list as empty rather than as undefined', async () => {
    const applications = api.applications();
    http.expectOne('/configuration/api/applications').flush({});
    expect(await applications).toEqual([]);
  });

  /**
   * The env directory is the listing narrowed, and asserting the ONE request is the point: there is
   * no per-application route for this, and the day somebody adds a helper that pretends there is,
   * `http.verify()` catches the second call.
   */
  it('narrows the listing to one application’s environments in one request', async () => {
    const envs = api.envsOf('qits-docs');

    http.expectOne('/configuration/api/applications').flush({
      applications: [
        { application: 'qits-ci', envs: [{ env: 'dev', entries: 9, headRevision: 90 }] },
        { application: 'qits-docs', envs: [{ env: 'prod', entries: 1, headRevision: 12 }] },
      ],
    });

    expect(await envs).toEqual([{ env: 'prod', entries: 1, headRevision: 12 }]);
  });

  it('answers an application this service holds nothing for with no environments', async () => {
    const envs = api.envsOf('qits-nothing');
    http.expectOne('/configuration/api/applications').flush({ applications: [] });
    expect(await envs).toEqual([]);
  });

  it('lists one application’s entries in one environment', async () => {
    const entries = api.entries('qits-docs', 'dev');

    const request = http.expectOne('/configuration/api/applications/qits-docs/envs/dev/entries');
    expect(request.request.method).toBe('GET');
    request.flush({ entries: [entry] });

    expect(await entries).toEqual([entry]);
  });

  it('carries orphaned off the wire rather than deciding it here', async () => {
    const entries = api.entries('qits-docs', 'dev');
    http
      .expectOne('/configuration/api/applications/qits-docs/envs/dev/entries')
      .flush({ entries: [{ ...entry, orphaned: true }] });

    expect((await entries)[0].orphaned).toBe(true);
  });

  it('reads the history of one environment in the order the service sent it', async () => {
    const history = api.history('qits-docs', 'prod');

    const request = http.expectOne('/configuration/api/applications/qits-docs/envs/prod/history');
    expect(request.request.method).toBe('GET');
    request.flush({
      revisions: [
        { seq: 41, env: 'prod', key: 'env.A', value: null, deleted: true },
        { seq: 38, env: 'prod', key: 'env.A', value: 'one', deleted: false },
      ],
    });

    expect((await history).map((revision) => revision.seq)).toEqual([41, 38]);
  });

  /**
   * The resolved read WITHOUT a version is exactly what the deployer asks for today — the entries
   * and nothing else — so the absent parameter has to be absent from the URL rather than sent empty.
   * A `?version=` naming the empty string is a different request, and the service answers it 400.
   */
  it('reads the resolved map with no version parameter at all when none is given', async () => {
    const resolved = api.resolved('qits-docs', 'dev');

    const request = http.expectOne('/configuration/api/applications/qits-docs/envs/dev/resolved');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.has('version')).toBe(false);
    request.flush({
      headRevision: 41,
      properties: { 'qits.platform.deployments.extras.qits-docs.env.QITS_REGISTRY': 'r:8080' },
    });

    expect((await resolved).headRevision).toBe(41);
  });

  it('passes the version through as the wire’s own query parameter', async () => {
    const resolved = api.resolved('qits-docs', 'dev', '2026.907.1');

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/configuration/api/applications/qits-docs/envs/dev/resolved' &&
        candidate.params.get('version') === '2026.907.1',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ headRevision: 41, properties: {} });

    expect((await resolved).properties).toEqual({});
  });

  it('lists an application’s declarations in the service’s own order', async () => {
    const declarations = api.declarations('qits-docs');

    const request = http.expectOne('/configuration/api/applications/qits-docs/declarations');
    expect(request.request.method).toBe('GET');
    request.flush({
      declarations: [
        { version: '2026.907.2', governing: true, keys: 4 },
        { version: '2026.907.1', governing: false, keys: 3 },
      ],
    });

    expect((await declarations).map((summary) => summary.version)).toEqual([
      '2026.907.2',
      '2026.907.1',
    ]);
  });

  it('reads a declarations envelope with no list as empty', async () => {
    const declarations = api.declarations('qits-docs');
    http.expectOne('/configuration/api/applications/qits-docs/declarations').flush({});
    expect(await declarations).toEqual([]);
  });

  it('reads one declaration whole: its parsed keys and the document itself', async () => {
    const declaration = api.declaration('qits-docs', '2026.907.2');

    const request = http.expectOne(
      '/configuration/api/applications/qits-docs/declarations/2026.907.2',
    );
    expect(request.request.method).toBe('GET');
    request.flush({
      application: 'qits-docs',
      version: '2026.907.2',
      deploymentTarget: 'platform',
      contentHash: 'ab12',
      governing: true,
      receivedAt: '2026-09-07T08:00:00Z',
      receivedBy: 'qits-ci',
      keys: [declared],
      raw: 'keys:\n  env.QITS_EVENTS_URL:\n    type: serviceAddress\n',
    });

    const answer = await declaration;
    expect(answer.keys).toEqual([declared]);
    expect(answer.raw).toContain('serviceAddress');
  });

  it('percent-encodes an application, an env and a version rather than pasting them into the path', async () => {
    const entries = api.entries('qits docs', 'pre prod');
    http
      .expectOne('/configuration/api/applications/qits%20docs/envs/pre%20prod/entries')
      .flush({ entries: [] });
    expect(await entries).toEqual([]);

    const declaration = api.declaration('qits docs', '1 0');
    http
      .expectOne('/configuration/api/applications/qits%20docs/declarations/1%200')
      .flush({ keys: [], raw: '' });
    expect((await declaration).keys).toEqual([]);
  });

  it('rejects with the service’s own message rather than swallowing it', async () => {
    const entries = api.entries('qits-docs', 'dev');

    http
      .expectOne('/configuration/api/applications/qits-docs/envs/dev/entries')
      .flush(
        { message: 'An application name is required' },
        { status: 400, statusText: 'Bad Request' },
      );

    await expect(entries).rejects.toMatchObject({
      status: 400,
      error: { message: 'An application name is required' },
    });
  });

  /**
   * The 404 a resolved read answers for a version nobody declared is not this class's to soften. A
   * caller that got an empty map back instead would be a caller handed a configuration missing every
   * default it asked for, with nothing to say so.
   */
  it('lets a resolved read for an undeclared version fail as the 404 it is', async () => {
    const resolved = api.resolved('qits-docs', 'dev', 'never-shipped');

    http
      .expectOne((candidate) => candidate.params.get('version') === 'never-shipped')
      .flush(
        { message: 'No declaration never-shipped for application qits-docs' },
        {
          status: 404,
          statusText: 'Not Found',
        },
      );

    await expect(resolved).rejects.toMatchObject({ status: 404 });
  });
});
