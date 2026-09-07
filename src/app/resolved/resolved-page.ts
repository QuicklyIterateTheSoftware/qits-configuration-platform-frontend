import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge, QitsPicker, type QitsPickerOption } from '@qits/ui-components';
import { ConfigurationApi } from '../api/configuration-api';
import type {
  ApplicationEnvSummary,
  ConfigurationEntry,
  Declaration,
  DeclarationSummary,
  DeclaredKey,
  ResolvedConfiguration,
} from '../api/dto';
import { bareKey } from '../api/extras';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { plural } from '../ui/format';
import { ConfigurationLinks } from '../ui/links';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import {
  declaredDetail,
  sourceLabel,
  sourceOf,
  sourceTone,
  typeTone,
  type ValueSource,
} from '../ui/source';

/** One line of the merged map: the property, what it holds, and where this client worked out it came from. */
interface ResolvedRow {
  readonly property: string;
  readonly key: string;
  readonly value: string;
  readonly source: ValueSource;
  readonly declared: DeclaredKey | undefined;
}

/**
 * The merged map one application in one environment would receive: the stored entries with a
 * declaration's defaults and rendered addresses merged underneath them.
 *
 * **Load budget: five requests, in two waves, and nothing per row.** The first wave is three reads
 * that do not depend on which version is being asked about — `GET /applications` for the tier list
 * this page hops between, `GET …/declarations` for the version list, and `GET …/envs/<env>/entries`
 * for the stored rows. The second wave is the two that do: `GET …/envs/<env>/resolved?version=…`,
 * which is the answer this page exists to draw, and `GET …/declarations/<version>`, which is the
 * only place the declared TYPE of each key exists. The declarations listing settles first on
 * purpose: with no version in the address it is the read that decides which version is being asked
 * about, and firing the resolved read before it would be firing it against a guess.
 *
 * **THE SOURCE COLUMN IS DERIVED HERE, AND THE WIRE DOES NOT CARRY IT.** The resolved read is the
 * deployer's, and the deployer is a configuration source rather than a screen: it receives a flat
 * map of names and values with no per-key metadata, which is the right shape for something that
 * layers the map verbatim. A person reading the same map needs the other half, because a declared
 * default and an operator's override are the same string there and the most different things on the
 * page. So the answer is worked out on the client, in `ui/source.ts`, from the two reads that do
 * carry it — the entries of this env and the declaration being resolved against — and this page
 * calls that one module rather than restating its rules.
 *
 * **What that derivation mirrors is the SERVICE's precedence, not this page's preference.** A
 * `serviceAddress` is rendered by the platform and is NOT overridable, so it wins first and a stored
 * row on such a key loses to it — the entries read reports that row orphaned for the same reason.
 * Below that a stored entry beats a declared default, and whether a person or the bootstrap import
 * stored it is `entryClass`, ordered at the write rather than here. A declared default is what is
 * left. Getting that order backwards would be a screen that disagrees with the deployment it claims
 * to describe, which is worse than no screen.
 *
 * **THE VERSION PICKER SAYS "NEWEST" AND NEVER SAYS WHICH VERSION AN ENVIRONMENT IS RUNNING.** Which
 * declaration a running deployment resolved against is recorded at that deployment's cutover, and
 * this service does not hold it — so no word on this page can honestly claim one. The governing
 * summary is the newest document this application has declared, which is a fact about the intake log
 * and nothing more. The page says so in its own sentence, because a reader who took the picker for a
 * statement about production would take this whole screen for a statement about production.
 *
 * **The version-absent read is a real address here, not a gap.** With no `version` parameter the
 * service answers the stored entries alone — no defaults, no rendered addresses — which is exactly
 * what the deployer asks for today, and it is worth being able to see beside the merged answer. A
 * version that names no declaration, by contrast, is a 404: absent means "I am not asking about
 * declarations", present means "resolve me against this document", and answering the second with a
 * bare entry map would hand back a configuration missing every default the caller asked for with
 * nothing to say so. The asymmetry is the service's and this page keeps it.
 *
 * **A 422 is an answer this read can give, and it is drawn as the service worded it.** A
 * `serviceAddress` whose target has never declared its deployment plane cannot be rendered: a
 * platform-plane service answers at its bare name and an environment-plane one at
 * `<env>-<name>`, either would be syntactically fine, and the wrong one is not an error anybody sees
 * — it is a container that boots, passes its health gate and dials a name docker's DNS does not
 * resolve. The service refuses the read rather than guessing, `ui/loadable.ts` carries its sentence
 * through, and this page draws it where the table would be.
 *
 * **Nothing here writes**, as nowhere in this application does. The picker changes which question is
 * asked; every answer on the page is a GET.
 */
@Component({
  selector: 'app-resolved-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QitsBadge, QitsPicker, Async, Empty],
  styleUrls: ['../ui/page.css'],
  template: `
    <p class="crumbs">
      <a [routerLink]="links.commands()">Applications</a>
      <span class="sep">/</span>
      <a [routerLink]="links.commands('applications', application())">{{ application() }}</a>
      <span class="sep">/</span>
      <a [routerLink]="links.commands('applications', application(), 'envs', env())">{{ env() }}</a>
      <span class="sep">/</span>
      <span>Resolved</span>
    </p>

    <header class="head">
      <h1>{{ application() }} — resolved in {{ env() }}</h1>
      <span class="head-links">
        <a [routerLink]="links.commands('applications', application(), 'envs', env())">Entries</a>
        <a [routerLink]="links.commands('applications', application(), 'matrix')"
          >Every environment</a
        >
      </span>
    </header>
    <p class="lede">
      The merged map a deployment of {{ application() }} started now in {{ env() }} would receive:
      this environment's stored entries, with a declaration's defaults and rendered addresses
      underneath them.
    </p>

    <div class="pickers">
      <section class="picker envs">
        <h2>Environment</h2>
        <app-async
          [state]="envsState()"
          loadingLabel="Loading environments"
          errorLabel="Could not load this application's environments"
          (retry)="loadEnvs()"
        />
        @if (envsState().kind === 'ready') {
          @if (envs().length === 0) {
            <app-empty
              message="This service holds no configuration for this application in any environment."
            />
          } @else {
            <ul class="env-list">
              @for (summary of envs(); track summary.env) {
                <li>
                  @if (summary.env === env()) {
                    <span class="env-here" aria-current="page">{{ summary.env }}</span>
                  } @else {
                    <a
                      [routerLink]="
                        links.commands(
                          'applications',
                          application(),
                          'envs',
                          summary.env,
                          'resolved'
                        )
                      "
                      [queryParams]="hopQuery()"
                      >{{ summary.env }}</a
                    >
                  }
                  <span class="env-count subtle">{{ entryCount(summary) }}</span>
                </li>
              }
            </ul>
          }
        }
      </section>

      <section class="picker versions">
        <h2>Declaration</h2>
        <app-async
          [state]="declarationsState()"
          loadingLabel="Loading declarations"
          errorLabel="Could not load this application's declarations"
          (retry)="loadDeclarations()"
        />
        @if (declarationsState().kind === 'ready') {
          @if (versionOptions().length === 0) {
            <app-empty
              message="This application has declared nothing, so there is nothing to merge underneath its entries. What is below is its stored rows alone."
            />
          } @else {
            <qits-picker
              [options]="versionOptions()"
              [value]="version()"
              (valueChange)="onPickVersion($event)"
              ariaLabel="Declaration version to resolve against"
              placeholder="No declaration — stored entries alone"
              clearLabel="Resolve against no declaration"
            />
          }
        }
      </section>
    </div>

    <p class="caveat" role="note">
      Newest is not a claim about what is running. Which declaration a running deployment resolved
      against is recorded at that deployment's cutover and this service does not hold it, so nothing
      on this page can tell you which version {{ env() }} settled on. This page answers what a
      deployment started now would receive — never what is running.
    </p>

    <app-async
      [state]="content()"
      loadingLabel="Resolving this configuration"
      errorLabel="Could not resolve this configuration"
      (retry)="loadContent()"
    />

    @if (content().kind === 'ready') {
      <p class="revision">
        Head revision <strong>{{ headRevision() }}</strong> — how far this environment's write log
        has run for {{ application() }}, and the number a consumer records to say which
        configuration a deployment received. It counts writes rather than entries, so it moves
        forward on a delete too and never moves backwards. It is scoped to {{ env() }}: another
        tier's writes are another tier's number.
      </p>

      @if (rows().length === 0) {
        <app-empty
          message="Nobody has configured this application in this environment, and its declaration adds nothing here. That is an empty map at revision 0 rather than a missing application — it will start with whatever its image and the deployer's own defaults give it."
        />
      } @else {
        <div class="scroll">
          <table>
            <caption>
              {{
                caption()
              }}, at the property names a consumer layers verbatim. Where each one came from is
              worked out here, from the entries and the declaration — the wire is flat and says
              nothing about it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Value</th>
                <th scope="col">Source</th>
                <th scope="col">Declared</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.property) {
                <tr>
                  <th scope="row" class="mono key">{{ row.key }}</th>
                  <td class="value mono">
                    @if (row.value.length === 0) {
                      <span class="subtle empty-value">(empty)</span>
                    } @else {
                      {{ row.value }}
                    }
                  </td>
                  <td>
                    <qits-badge [label]="sourceLabel(row.source)" [tone]="sourceTone(row.source)" />
                  </td>
                  <td class="declared">
                    @if (row.declared; as declared) {
                      <qits-badge [label]="declared.type" [tone]="typeTone(declared.type)" />
                      @if (declaredDetail(declared); as detail) {
                        <span class="detail mono subtle">{{ detail }}</span>
                      }
                    } @else {
                      <span class="subtle undeclared">not declared</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    <p class="note">
      A key declared with no default and never set is absent from this map on purpose: the container
      is given no variable rather than an empty one. A stored row on a serviceAddress key is absent
      for a different reason — the platform renders that address per environment and the row is
      ignored in favour of it, which is what the entries page reports as orphaned.
    </p>
    <p class="note">
      This view is read-only. Every entry under it is written through the API by the platform's own
      processes, each write part of a larger operation with more to do afterwards.
    </p>
  `,
  styles: `
    /* The two sideways doors out of this page: the same env's stored rows, and the same key across
       every env. They sit in the heading rather than in the prose because they are where a reader
       goes NEXT after this table surprises them, and a link buried in a paragraph is a link found
       on the second reading. */
    .head-links {
      display: flex;
      gap: 1rem;
      white-space: nowrap;
    }
    .head-links a {
      color: #4338ca;
    }

    /* The two choosers sit side by side and wrap on a narrow screen. They are a header for the
       table rather than a panel of their own, so they are quiet: small headings, no border. */
    .pickers {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin: 0 0 0.75rem;
    }
    .picker {
      min-width: 14rem;
      flex: 1 1 16rem;
    }
    .picker h2 {
      margin: 0 0 0.35rem;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 600;
    }

    /* THE ENVIRONMENT HOP IS LINKS AND THE DECLARATION IS A PICKER, and the split is not a stylistic
       one. Every tier of this page is its own address — a reader opens one in a new tab, copies it
       into a chat and expects the version they were looking at to travel with it — and only a link
       is all three of those things. The tiers are also a small closed set that fits on one line.
       Versions are neither: an application accumulates them without limit, and forty links would be
       the page rather than a control on it. */
    .env-list {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 0;
      padding: 0;
    }
    .env-list a {
      color: #4338ca;
    }
    .env-here {
      font-weight: 600;
    }
    .env-count {
      font-size: 0.85em;
    }

    /* The caveat is drawn as a note and not as a warning: nothing is wrong, there is simply a
       question this page cannot answer, and colouring it as a fault would train a reader to skip
       the one paragraph that stops them misreading everything below it. */
    .caveat {
      margin: 0 0 1rem;
      padding: 0.5rem 0.75rem;
      border-left: 3px solid #d1d5db;
      color: #4b5563;
      font-size: 0.88rem;
    }

    .revision {
      margin: 0.15rem 0 1rem;
      color: #4b5563;
      font-size: 0.88rem;
    }

    /* The key column, as on the entries page: long enough for env.QITS_SOMETHING_LONG without
       wrapping, and wrapping rather than widening the table when a key beats that. */
    .key {
      font-weight: 500;
      max-width: 22rem;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .empty-value {
      font-style: italic;
    }
    .declared .detail {
      margin-left: 0.4rem;
    }
    .undeclared {
      font-style: italic;
      font-size: 0.85em;
    }
  `,
})
export class ResolvedPage {
  protected readonly links = inject(ConfigurationLinks);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ConfigurationApi);

  protected readonly sourceLabel = sourceLabel;
  protected readonly sourceTone = sourceTone;
  protected readonly typeTone = typeTone;
  protected readonly declaredDetail = declaredDetail;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /** The application, as the path segment spells it. Not validated here — the service answers. */
  protected readonly application = computed(() => this.params().get('application') ?? '');

  /**
   * The environment, as the path segment spells it.
   *
   * There is no env-less spelling of this page and there must not be. A resolved map is one tier's
   * answer, and a reader who could not see which tier produced it would read prod's answer as dev's
   * — which is the one failure of this service nobody would notice.
   */
  protected readonly env = computed(() => this.params().get('env') ?? '');

  /**
   * The `version` query parameter exactly as the address carries it: a version, the empty string, or
   * null for a parameter that is not there at all.
   *
   * **The three are three different questions and this page keeps them apart.** No parameter is no
   * opinion, and the page picks the newest declaration because that is the only useful default.
   * `?version=` empty is an opinion — resolve this environment against no declaration at all, which
   * is the read the deployer makes today — and it has to be an address a reader can bookmark and
   * send rather than a state that evaporates on reload. A named version is the third. The service is
   * told the same thing for the first two spellings it is asked about: the parameter is simply
   * omitted from a request that is not asking about declarations.
   */
  private readonly requestedVersion = computed(() => this.queryParams().get('version'));

  /** The tier list, which is also the env hop. */
  protected readonly envsState = signal<Loadable<readonly ApplicationEnvSummary[]>>(LOADING);

  /** The version list, which is also what decides the default version. */
  protected readonly declarationsState = signal<Loadable<readonly DeclarationSummary[]>>(LOADING);

  private readonly entriesState = signal<Loadable<readonly ConfigurationEntry[]>>(LOADING);
  private readonly resolvedState = signal<Loadable<ResolvedConfiguration>>(LOADING);

  /** The declaration being resolved against, or null when no version is being asked about. */
  private readonly declarationState = signal<Loadable<Declaration | null>>(LOADING);

  protected readonly envs = computed(() => {
    const state = this.envsState();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly declarations = computed(() => {
    const state = this.declarationsState();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * Which version this page is resolving against, or undefined for "against none".
   *
   * The address wins where it says anything, so a link somebody sent lands on the version they were
   * looking at rather than on whatever has since arrived. Where it says nothing the newest
   * declaration is taken — `governing` is the service's own flag, decided by the intake log rather
   * than by version ordering, and a client that worked it out from `receivedAt` would be a client
   * that invites working it out wrong.
   */
  protected readonly version = computed<string | undefined>(() => {
    const requested = this.requestedVersion();
    if (requested !== null) {
      return requested.length > 0 ? requested : undefined;
    }
    const declarations = this.declarations();
    return (declarations.find((summary) => summary.governing) ?? declarations[0])?.version;
  });

  /**
   * The version list as the picker draws it.
   *
   * **The governing document is labelled "newest" and that word is chosen against three others.**
   * "Deployed", "live" and "current" would each be a claim about what an environment is running, and
   * this service holds no such fact: which declaration a deployment resolved against is recorded at
   * its cutover and lives with the deployer. "Newest" says only what the intake log says.
   */
  protected readonly versionOptions = computed<readonly QitsPickerOption<string>[]>(() =>
    this.declarations().map((summary) => ({
      value: summary.version,
      label: summary.governing ? `${summary.version} — newest` : summary.version,
    })),
  );

  /** What an env link carries across, so a hop between tiers keeps the version being looked at. */
  protected readonly hopQuery = computed(() => {
    const requested = this.requestedVersion();
    return requested === null ? {} : { version: requested };
  });

  /**
   * The table, which needs all three of its reads before it can say anything true.
   *
   * A failed entries read would turn every operator override into a "default" and every default into
   * an "unexplained", which is a table that looks complete and is wrong about every row — so the
   * three are one panel rather than three, and any one of them failing is the panel failing. The
   * resolved read is checked first because it is the one this page is a view of, and because it is
   * where the 422 about an unrenderable address arrives.
   */
  protected readonly content = computed<Loadable<readonly ResolvedRow[]>>(() => {
    const declarations = this.declarationsState();
    if (declarations.kind === 'error') return declarations;
    const resolved = this.resolvedState();
    if (resolved.kind === 'error') return resolved;
    const entries = this.entriesState();
    if (entries.kind === 'error') return entries;
    const declaration = this.declarationState();
    if (declaration.kind === 'error') return declaration;
    if (resolved.kind !== 'ready' || entries.kind !== 'ready' || declaration.kind !== 'ready') {
      return LOADING;
    }
    return ready(this.rowsOf(resolved.value, entries.value, declaration.value));
  });

  protected readonly rows = computed(() => {
    const content = this.content();
    return content.kind === 'ready' ? content.value : [];
  });

  protected readonly headRevision = computed(() => {
    const resolved = this.resolvedState();
    return resolved.kind === 'ready' ? resolved.value.headRevision : 0;
  });

  protected readonly caption = computed(() =>
    plural(this.rows().length, 'resolved property', 'resolved properties'),
  );

  constructor() {
    // The application and the env are path segments, so hopping tiers REUSES this component rather
    // than rebuilding it. Reading them as signals is what makes that navigation a fetch.
    effect(() => {
      const application = this.application();
      const env = this.env();
      if (application.length > 0 && env.length > 0) {
        this.loadEnvs();
        this.loadDeclarations();
        this.loadEntries();
      }
    });

    // The second wave. It waits for the declarations listing because with no version in the address
    // that listing is what names the version — firing before it would fire against a guess — and it
    // re-runs when the query parameter moves, which is what makes the picker a navigation rather
    // than a hidden piece of component state.
    effect(() => {
      const application = this.application();
      const env = this.env();
      if (application.length === 0 || env.length === 0) return;
      if (this.declarationsState().kind !== 'ready') return;
      this.loadContent(application, env, this.version());
    });
  }

  /** The tier list. Its own retry, because a failed env hop must not blank the table. */
  protected loadEnvs(): void {
    const application = this.application();
    this.envsState.set(LOADING);
    this.api.envsOf(application).then(
      (envs) => this.envsState.set(ready(envs)),
      (error: unknown) => this.envsState.set(failed(error)),
    );
  }

  /** The version list. */
  protected loadDeclarations(): void {
    const application = this.application();
    this.declarationsState.set(LOADING);
    this.api.declarations(application).then(
      (declarations) => this.declarationsState.set(ready(declarations)),
      (error: unknown) => this.declarationsState.set(failed(error)),
    );
  }

  private loadEntries(): void {
    const application = this.application();
    const env = this.env();
    this.entriesState.set(LOADING);
    this.api.entries(application, env).then(
      (entries) => this.entriesState.set(ready(entries)),
      (error: unknown) => this.entriesState.set(failed(error)),
    );
  }

  /**
   * The two version-dependent reads, together, because the table needs both.
   *
   * With no version there is no second read to make: the service is not being asked about
   * declarations, so there is no document whose types and defaults could explain a row, and every
   * property in the answer is a stored entry by construction.
   */
  protected loadContent(
    application: string = this.application(),
    env: string = this.env(),
    version: string | undefined = this.version(),
  ): void {
    this.resolvedState.set(LOADING);
    this.declarationState.set(LOADING);
    this.api.resolved(application, env, version).then(
      (resolved) => this.resolvedState.set(ready(resolved)),
      (error: unknown) => this.resolvedState.set(failed(error)),
    );
    if (version === undefined) {
      this.declarationState.set(ready(null));
      return;
    }
    this.api.declaration(application, version).then(
      (declaration) => this.declarationState.set(ready(declaration)),
      (error: unknown) => this.declarationState.set(failed(error)),
    );
  }

  /**
   * Picking a version is a NAVIGATION and never a hidden signal.
   *
   * The version is in the address so that the screen a reader is looking at is the screen they can
   * send; a picker that only moved component state would leave two operators comparing notes about
   * the same URL and different answers. Clearing the picker is the version-less read, spelled
   * `?version=` — see {@link requestedVersion} for why that is a different address from no parameter
   * at all.
   */
  protected onPickVersion(version: string | undefined): void {
    void this.router.navigate(
      this.links.commands('applications', this.application(), 'envs', this.env(), 'resolved'),
      { queryParams: { version: version ?? '' } },
    );
  }

  /** `3 entries` — the tier list's own count, so a hop says how much is over there. */
  protected entryCount(summary: ApplicationEnvSummary): string {
    return plural(summary.entries, 'entry', 'entries');
  }

  /**
   * One row per property in the answer, each asked where it came from.
   *
   * **Sorted by key rather than left in wire order, and that is a display decision worth saying out
   * loud.** The map arrives in the order the service built it — every declared key first, then every
   * stored row — which is a fact about how the merge was performed and not a question anybody is
   * asking. A reader scans this table for a key by name, and the source column already says which
   * half of that merge each row came from, more precisely than the ordering ever could.
   */
  private rowsOf(
    resolved: ResolvedConfiguration,
    entries: readonly ConfigurationEntry[],
    declaration: Declaration | null,
  ): readonly ResolvedRow[] {
    const application = this.application();
    const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
    const declaredByKey = new Map((declaration?.keys ?? []).map((key) => [key.key, key]));
    return Object.entries(resolved.properties ?? {})
      .map(([property, value]) => {
        const key = bareKey(application, property);
        const declared = declaredByKey.get(key);
        return {
          property,
          key,
          value,
          declared,
          source: sourceOf(entryByKey.get(key), declared),
        };
      })
      .sort((left, right) => left.key.localeCompare(right.key));
  }
}
