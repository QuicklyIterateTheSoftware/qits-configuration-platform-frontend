import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  ApplicationEnvSummary,
  ApplicationSummary,
  ConfigurationEntry,
  ConfigurationRevision,
  Declaration,
  DeclarationSummary,
  ListApplicationsResponse,
  ListDeclarationsResponse,
  ListEntriesResponse,
  ListHistoryResponse,
  ResolvedConfiguration,
} from './dto';

/**
 * Everything this app reads, and it speaks to exactly one upstream: qits-configuration, through the
 * edge, at `/configuration/api`.
 *
 * **THERE IS NO WRITE HERE, and its absence is the design.** The entries are system state: the
 * platform's own processes set them through the API, each write part of a larger operation with
 * more to do afterwards. This app is a reader of that state, so it holds no PUT and no DELETE —
 * nothing for a screen to reach for.
 *
 * Two consequences of the reads are deliberate:
 *
 * - **Every call is one-shot.** `firstValueFrom` unwraps the observable immediately, and there is no
 *   `httpResource` anywhere: the pages re-issue their own read from a retry button rather than on a
 *   schedule, so what is on screen is what the store answered rather than what a cache remembers.
 * - **Failures are thrown, not described.** An `HttpErrorResponse` reaching a caller still holds the
 *   service's `{"message": …}` body, and `ui/loadable.ts` is where that body is read, in one place.
 *
 * `HttpClient` on the fetch backend rather than bare `fetch()` buys two things: `HttpTestingController`,
 * which is the whole basis of this repository's specs, and a call that goes through `window.fetch`,
 * where the platform's browser telemetry can see it.
 *
 * **No `credentials` option anywhere, and that is the code that makes these calls correct.** Every
 * request is same-origin behind the edge, which sends the session cookie by default; the only value
 * worth setting would be the default, and the only value worth fearing (`omit`) would make every
 * call 401 at once.
 *
 * **THE ENV IS A PATH SEGMENT, and the env-less spellings are gone from here.** The service holds
 * every environment's configuration in one store now, so the address of a value is
 * `…/applications/<app>/envs/<env>/…`. Its legacy env-less routes still answer — they resolve
 * against the instance's backfilled env — and this class deliberately does not call them: a reader
 * who cannot see WHICH tier a row belongs to is a reader who will read prod's answer as dev's. The
 * env a page reads comes from {@link applications}, which is the only place that says which tiers an
 * application even has.
 *
 * **THE RESOLVED READ IS HERE NOW, FOR READS, and it overturns what this class used to say.** It
 * used to record that `…/resolved` was deliberately absent because it is the deployer's own read — a
 * flat, fully-prefixed property map layered verbatim — and that adding it would invite a screen. The
 * screen is the point now: with declarations in the store, that map is the only place a person can
 * see a declared default and a rendered address standing beside the entries somebody actually wrote,
 * which is the question every argument about a misbehaving deployment turns on. Reading it costs
 * nothing and changes nothing.
 *
 * **The other half of that stance stands untouched.** `POST …/import` is the bootstrap's bulk
 * seeding and is still absent, as is every write — including the declaration POST and DELETE, which
 * are the pipeline's and are guarded machine-only for a reason a browser cannot satisfy. What this
 * class gained is a read.
 */
@Injectable({ providedIn: 'root' })
export class ConfigurationApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Every application this service holds configuration for, each with one row per environment it is
   * configured in.
   *
   * This is the listing AND the env directory: nothing else on the wire says which tiers an
   * application exists in, so every env-addressed page starts here.
   */
  async applications(): Promise<readonly ApplicationSummary[]> {
    const response = await firstValueFrom(
      this.http.get<ListApplicationsResponse>(`${this.base}/configuration/api/applications`),
    );
    return response.applications ?? [];
  }

  /**
   * The environments one application is configured in, newest listing first asked.
   *
   * It is {@link applications} narrowed rather than a route of its own, because there is no such
   * route: the listing is one request whether a page wants every application or one, and a helper
   * that pretended otherwise would hide that from a load budget. An application this service holds
   * nothing for answers an empty array, which is "no tiers configured" and never an error.
   */
  async envsOf(application: string): Promise<readonly ApplicationEnvSummary[]> {
    const applications = await this.applications();
    return applications.find((summary) => summary.application === application)?.envs ?? [];
  }

  /**
   * One application's current entries in one environment.
   *
   * An application nobody has configured is not a 404 here — the service answers an empty list — so
   * an empty array means "nothing stored", never "no such application". The same holds for an env
   * nobody has written into.
   *
   * Each row carries `orphaned`, decided against the application's governing declaration and
   * computed at read time. It is not a claim that the row is wrong; it is a claim that the row is
   * not reaching the container.
   */
  async entries(application: string, env: string): Promise<readonly ConfigurationEntry[]> {
    const response = await firstValueFrom(
      this.http.get<ListEntriesResponse>(`${this.envUrl(application, env)}/entries`),
    );
    return response.entries ?? [];
  }

  /**
   * One application's write history in one environment, newest first. Deletions are in it, with a
   * null value.
   *
   * The order is the SERVICE's and is not re-sorted here: `seq` is the append-only log's own
   * sequence, and a client that sorted by timestamp instead would disagree with it the moment two
   * writes share an instant. The seqs are global to the log rather than per-env, so a gap between
   * two rows is another environment's write and not a missing one.
   */
  async history(application: string, env: string): Promise<readonly ConfigurationRevision[]> {
    const response = await firstValueFrom(
      this.http.get<ListHistoryResponse>(`${this.envUrl(application, env)}/history`),
    );
    return response.revisions ?? [];
  }

  /**
   * What the deployer would receive for one application in one environment: a flat map of fully
   * prefixed property names.
   *
   * **`version` is what turns this into the overlay read.** Given one, the answer is that version's
   * declaration merged underneath the stored entries — declared defaults for keys nobody has set,
   * and `serviceAddress` keys rendered for THIS environment. Omitted, the answer is the entries and
   * nothing else, which is exactly what the deployer asks for today.
   *
   * A version that names no declaration is a 404, unlike an application with no entries. The
   * asymmetry is the service's and is worth keeping in mind here: absent means "not asking about
   * declarations", present means "resolve me against this document".
   */
  async resolved(
    application: string,
    env: string,
    version?: string,
  ): Promise<ResolvedConfiguration> {
    const params = version ? new HttpParams().set('version', version) : undefined;
    return await firstValueFrom(
      this.http.get<ResolvedConfiguration>(`${this.envUrl(application, env)}/resolved`, { params }),
    );
  }

  /**
   * Every version one application has declared, newest intake first, with the governing one flagged.
   *
   * The order is the service's. So is `governing`: which document an application is judged against
   * is decided by the intake log and not by version ordering, and a client that worked it out from
   * `receivedAt` would be a client that invites working it out wrong.
   */
  async declarations(application: string): Promise<readonly DeclarationSummary[]> {
    const response = await firstValueFrom(
      this.http.get<ListDeclarationsResponse>(`${this.applicationUrl(application)}/declarations`),
    );
    return response.declarations ?? [];
  }

  /**
   * One declaration in full: the keys the service parsed out of the document, and the document.
   *
   * Both halves arrive together and both are drawn, because the whole value of having them side by
   * side is seeing whether they agree — a `description:` line that reads one way and a `type:` that
   * behaves another is a discrepancy nobody would find in either half alone.
   *
   * A version this application never declared is a 404, and that is the honest answer rather than an
   * empty document.
   */
  async declaration(application: string, version: string): Promise<Declaration> {
    return await firstValueFrom(
      this.http.get<Declaration>(
        `${this.applicationUrl(application)}/declarations/${encodeURIComponent(version)}`,
      ),
    );
  }

  private applicationUrl(application: string): string {
    return `${this.base}/configuration/api/applications/${encodeURIComponent(application)}`;
  }

  private envUrl(application: string, env: string): string {
    return `${this.applicationUrl(application)}/envs/${encodeURIComponent(env)}`;
  }
}
