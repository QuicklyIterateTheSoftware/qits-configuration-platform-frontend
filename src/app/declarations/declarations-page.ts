import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge } from '@qits/ui-components';
import { ConfigurationApi } from '../api/configuration-api';
import type { Declaration, DeclarationSummary } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, actor, formatInstant, plural } from '../ui/format';
import { LOADING, IDLE, failed, ready, type Loadable } from '../ui/loadable';
import { ConfigurationLinks } from '../ui/links';
import { declaredDetail, isSystemOnly, typeTone } from '../ui/source';

/**
 * How much of a content hash a listing row shows. Twelve hex characters is what every git-shaped
 * surface on this platform abbreviates to and it is the length a person can compare by eye without
 * losing their place. It is a PREFIX and the page says so out loud rather than letting a truncated
 * string pass for a hash: a reader who quoted this into a ticket as "the hash" would be quoting
 * something no API will match.
 */
const HASH_PREFIX = 12;

/** The first {@link HASH_PREFIX} characters, with an ellipsis that admits there is more. */
function abbreviate(hash: string): string {
  return hash.length > HASH_PREFIX ? `${hash.slice(0, HASH_PREFIX)}…` : hash;
}

/**
 * What an application says its OWN configuration keys are — one document per version, and the one
 * version it is currently judged against.
 *
 * **This is the other half of the entries page.** An entry is what somebody stored; a declaration is
 * what the application claims to have, with a type and a fallback for each key. Read together they
 * answer the two questions an argument about a misbehaving deployment turns on: is this key even
 * supposed to exist, and what happens when nobody sets it.
 *
 * **The order is the SERVICE's and is not re-sorted here.** Which document governs is decided by the
 * intake log — the newest POST wins — and NOT by version ordering, which the service deliberately
 * has no opinion about: `1.4.0` posted this morning governs over `1.10.0` posted last week, because
 * the pipeline that posted it is what says what is deployed. A client that sorted these rows by
 * version would be a client whose top row and whose `governing` badge disagreed, and readers trust
 * position over badges.
 *
 * **Two reads, two {@link Loadable}s, and that split is the point.** The listing is how a reader
 * chooses; the per-version document is what they came to read. A detail read that failed — a version
 * removed between the two requests, a service that went away mid-page — must not take the list of
 * versions down with it, because the list is what they need to get somewhere else.
 *
 * **Load budget: two requests, and nothing per row.** With the version in the address they go out
 * together; without it, the document waits for the listing to say which version governs. That wait
 * is the address's own openness rather than a stall.
 *
 * **THE `description:` IS NOT ON THE WIRE, and this page does not pretend otherwise.** The service
 * validates the attribute and gives it no field of its own — `DeclaredKeyDto` has no
 * `description` — so the parsed table below cannot show one, and the honest thing to do about that
 * is say so and put the document itself on the same screen. What this page will NOT do is parse the
 * YAML in the browser to recover it: that would be a second opinion about a document with exactly
 * one parser, and it would be the copy no deployment exercises. A description recovered client-side
 * from a document the service read differently is worse than no description, because it reads as
 * authoritative.
 *
 * **Both halves are drawn together for the same reason the API returns both.** The parsed keys are
 * what the service acts on and the raw text is what the application committed, and the whole value
 * of having them side by side is seeing whether they agree: a `description:` line that reads one way
 * and a `type:` that behaves another is a discrepancy nobody would find in either half alone. The
 * parsed side is also the only place a reader can see what was DROPPED.
 *
 * **Nothing here posts or deletes a declaration.** Those routes exist and they are the pipeline's:
 * machine-guarded, because a declaration is a claim about what a BUILD contains and a browser cannot
 * honestly make one. A button here would let a person assert, in an application's name, something
 * that application's source does not say. The page states that in a sentence rather than leaving a
 * screen with no buttons to read as a screen whose buttons failed to load.
 */
@Component({
  selector: 'app-declarations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QitsBadge, Async, Empty],
  styleUrls: ['../ui/page.css'],
  template: `
    <p class="crumbs">
      <a [routerLink]="links.commands()">Applications</a>
      <span class="sep">/</span>
      <a [routerLink]="links.commands('applications', application())">{{ application() }}</a>
      <span class="sep">/</span>
      <span>Declarations</span>
    </p>

    <header class="head">
      <div class="title">
        <h1>{{ application() }} — declarations</h1>
      </div>
      <a class="entries-link" [routerLink]="links.commands('applications', application())"
        >Entries</a
      >
    </header>
    <p class="lede">
      What this application declares its own configuration keys to be: one document per version,
      with a type and a fallback for every key.
    </p>
    <p class="posture">
      Declarations are posted by the application's own pipeline and that route is machine-guarded,
      so this view is read-only. A browser cannot honestly assert what a build declared.
    </p>

    <section class="versions">
      <h2>Versions</h2>

      <app-async
        [state]="listState()"
        loadingLabel="Loading declarations"
        errorLabel="Could not load the declarations"
        (retry)="loadList()"
      />

      @if (listState().kind === 'ready') {
        @if (summaries().length === 0) {
          <app-empty
            message="This application has declared nothing. Its keys are whatever is stored for it, and none of them can be checked against a declaration."
          />
        } @else {
          <div class="scroll">
            <table>
              <caption>
                {{
                  listCaption()
                }}, newest intake first. Which one governs is decided by the intake log and not by
                version ordering, so the governing document is the one marked rather than the one at
                the top. The hash column shows the first
                {{
                  hashPrefixLength
                }}
                characters of a content hash, never the whole of one.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Governing</th>
                  <th scope="col">Target</th>
                  <th scope="col" class="num">Keys</th>
                  <th scope="col">Content hash</th>
                  <th scope="col">Received</th>
                </tr>
              </thead>
              <tbody>
                @for (summary of summaries(); track summary.version) {
                  <tr [class.selected]="summary.version === version()">
                    <th scope="row">
                      <a
                        [routerLink]="
                          links.commands(
                            'applications',
                            application(),
                            'declarations',
                            summary.version
                          )
                        "
                        [attr.aria-current]="summary.version === version() ? 'page' : null"
                        >{{ summary.version }}</a
                      >
                    </th>
                    <td>
                      @if (summary.governing) {
                        <qits-badge label="governing" tone="success" />
                      } @else {
                        <span class="subtle">{{ NONE }}</span>
                      }
                    </td>
                    <td class="subtle">{{ summary.deploymentTarget }}</td>
                    <td class="num">{{ summary.keys }}</td>
                    <td class="mono subtle">{{ abbreviate(summary.contentHash) }}</td>
                    <td class="subtle received">
                      {{ formatInstant(summary.receivedAt) }}<br />
                      <span class="by">by {{ actor(summary.receivedBy) }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>

    @if (version().length > 0) {
      <section class="document">
        <h2>Version {{ version() }}</h2>

        <app-async
          [state]="detailState()"
          loadingLabel="Loading the declaration"
          errorLabel="Could not load this declaration"
          (retry)="loadDetail()"
        />

        @if (declaration(); as declared) {
          <p class="facts">
            <qits-badge
              [label]="declared.governing ? 'governing' : 'superseded'"
              [tone]="declared.governing ? 'success' : 'neutral'"
            />
            <span class="subtle">{{ declared.deploymentTarget }} plane</span>
            <span class="subtle"
              >received {{ formatInstant(declared.receivedAt) }} by
              {{ actor(declared.receivedBy) }}</span
            >
          </p>
          <p class="hash mono subtle">{{ declared.contentHash }}</p>

          @if (declared.keys.length === 0) {
            <app-empty
              message="This version declares no keys. It is a document that says the application has none of its own, which is a claim rather than an omission."
            />
          } @else {
            <div class="scroll">
              <table>
                <caption>
                  {{
                    keyCaption(declared)
                  }}. A dash in the default column is not an empty default: a key with no default
                  and no stored entry is ABSENT from the resolved map, so the container sees no such
                  variable at all rather than one set to nothing. Neither platform type can carry a
                  default — a serviceAddress is rendered for whichever environment is asking, and a
                  packageVersion is whatever released the package.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Type</th>
                    <th scope="col">Default</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  @for (key of declared.keys; track key.key) {
                    <tr [class.system]="isSystemOnly(key.type)">
                      <th scope="row" class="mono key">{{ key.key }}</th>
                      <td><qits-badge [label]="key.type" [tone]="typeTone(key.type)" /></td>
                      <td class="value mono">
                        @if (key.defaultValue) {
                          {{ key.defaultValue }}
                        } @else if (key.defaultValue === null) {
                          <span class="subtle no-default">{{ NONE }}</span>
                        } @else {
                          <span class="subtle no-default">(empty)</span>
                        }
                      </td>
                      <td class="mono">
                        @if (declaredDetail(key); as detail) {
                          {{ detail }}
                        } @else {
                          <span class="subtle">{{ NONE }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <h3>The document, as it was committed</h3>
          <p class="note">
            A key's <code>description:</code> is not in the table above and cannot be: the service
            validates the attribute and gives it no field of its own, carrying it only in the
            document. This page will not re-read the YAML to recover one — there is exactly one
            parser of this document and it is the service's — so the descriptions are read here,
            where they were written.
          </p>
          <pre class="raw">{{ declared.raw }}</pre>
        }
      </section>
    }

    <p class="note">
      A declaration says what an application HAS, not what it is set to. What each key resolves to
      in one environment — a stored entry, a declared default, or an address the platform rendered —
      is the resolved view of that environment.
    </p>
  `,
  styles: `
    /* Two panels, each with its own heading, on one page. The rule is spacing rather than boxes: a
       card around each would have made the document look like an aside to the list, when it is the
       thing the page is for and the list is the way to it. */
    section {
      margin-top: 1.5rem;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.05rem;
      overflow-wrap: anywhere;
    }
    h3 {
      margin: 1.25rem 0 0.35rem;
      font-size: 0.95rem;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .entries-link {
      color: #4338ca;
      white-space: nowrap;
    }
    .posture {
      margin: 0 0 1rem;
      color: #6b7280;
      font-size: 0.88rem;
    }
    /* The facts about one version, on one line: what it is, where it deploys, when it arrived. They
       are a paragraph rather than a table because there are three of them and a three-row table is a
       list wearing a grid. */
    .facts {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin: 0 0 0.35rem;
      font-size: 0.9rem;
    }
    /* THE WHOLE HASH, here and nowhere else. The listing abbreviates because it has six columns to
       fit; this line has the room, so the one place a reader can copy the hash from is a place that
       shows all of it. */
    .hash {
      margin: 0 0 0.75rem;
      overflow-wrap: anywhere;
    }
    .key {
      max-width: 22rem;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .no-default {
      font-style: italic;
    }
    /* The intake, two lines in one cell: when, then who. The second line is smaller because the
       timestamp is what a reader scans a column of these for and the actor is what they read once
       they have found the row. */
    .received .by {
      font-size: 0.85em;
    }
    /* The version being read, marked in the list it was chosen from. A left rule rather than a
       background: the row's own cells carry badges and monospace text whose contrast a fill would
       eat into, and a reader scanning for "which one am I looking at" reads the margin first. */
    .selected {
      box-shadow: inset 0.2rem 0 0 -0.05rem #4338ca;
    }
    .selected th a {
      font-weight: 600;
    }
    /* A key the platform fills in. Dimmed rather than hidden: it IS declared, and a reader who
       could not see it would go looking for the declaration that "forgot" it. The dash in its
       default column means "there can be none" rather than "nobody wrote one", which is what the
       caption says and what this shade keeps a reader from misreading row by row. */
    .system td.value {
      opacity: 0.7;
    }
    /* THE DOCUMENT, BYTE FOR BYTE. \`pre\` and not \`pre-wrap\`: the content hash is taken over
       exactly these bytes, so a view that re-wrapped a long line would be showing a document that
       hashes to something else — and YAML is whitespace-significant besides, which makes a
       re-flowed line a different document to a reader as well as to a digest. It scrolls
       sideways instead, and nothing about it is truncated. */
    .raw {
      margin: 0;
      padding: 0.75rem 0.9rem;
      overflow-x: auto;
      white-space: pre;
      tab-size: 2;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 0.375rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.85em;
      line-height: 1.45;
    }
  `,
})
export class DeclarationsPage {
  protected readonly links = inject(ConfigurationLinks);

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ConfigurationApi);

  protected readonly NONE = NONE;
  protected readonly actor = actor;
  protected readonly formatInstant = formatInstant;
  protected readonly abbreviate = abbreviate;
  protected readonly hashPrefixLength = HASH_PREFIX;
  protected readonly declaredDetail = declaredDetail;
  protected readonly isSystemOnly = isSystemOnly;
  protected readonly typeTone = typeTone;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly application = computed(() => this.params().get('application') ?? '');

  /**
   * The version the ADDRESS names, empty where it names none.
   *
   * A version is a path segment here rather than a query parameter because it is a resource: it has
   * a document, a hash and an intake, and it is the thing being looked at.
   */
  private readonly addressedVersion = computed(() => this.params().get('version') ?? '');

  /** Every version this application has declared. Its failure is not the document's. */
  protected readonly listState = signal<Loadable<readonly DeclarationSummary[]>>(LOADING);

  protected readonly summaries = computed(() => {
    const state = this.listState();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * The version on screen: the one the address names, or the governing one.
   *
   * **Governing rather than first, and the two are not the same row.** The listing is newest intake
   * first and the newest intake is normally what governs — but "normally" is not a rule this page
   * may rely on, and the service publishes the flag precisely so a client need not guess. The first
   * row is the fallback only for a listing that flags nothing, which should not happen and is still
   * better answered with a document than with an empty panel.
   *
   * **The address is never rewritten to name it.** `…/declarations` means "whichever document this
   * application is judged against", which is a question with a moving answer: a link written today
   * should show next month's governing document next month, and a redirect would freeze it at
   * today's version the first time somebody followed it.
   */
  protected readonly version = computed(() => {
    const addressed = this.addressedVersion();
    if (addressed.length > 0) {
      return addressed;
    }
    const summaries = this.summaries();
    return (summaries.find((summary) => summary.governing) ?? summaries[0])?.version ?? '';
  });

  /**
   * The chosen document. **IDLE rather than LOADING until a version is settled**, because a shimmer
   * is a promise that something is on its way, and before the listing answers nothing is.
   */
  protected readonly detailState = signal<Loadable<Declaration>>(IDLE);

  protected readonly declaration = computed(() => {
    const state = this.detailState();
    return state.kind === 'ready' ? state.value : undefined;
  });

  protected readonly listCaption = computed(() =>
    plural(this.summaries().length, 'declared version', 'declared versions'),
  );

  /** `7 declared keys` — the count comes off the document rather than off the listing row. */
  protected keyCaption(declaration: Declaration): string {
    return plural(declaration.keys.length, 'declared key', 'declared keys');
  }

  constructor() {
    // The application is a path segment, so this component is reused across two applications'
    // declarations. Reading it as a signal is what makes that navigation a fetch. The listing
    // depends on the application ALONE, so moving between two versions of one application re-reads
    // the document and leaves the listing's own request alone.
    effect(() => {
      const application = this.application();
      if (application.length > 0) {
        this.loadList();
      }
    });

    // The document depends on both, and `version` is a computed over the listing — which is what
    // makes the version-less spelling work without a second code path: the effect runs once with no
    // version and does nothing, then again the moment the listing names the governing one.
    effect(() => {
      const application = this.application();
      const version = this.version();
      if (application.length > 0 && version.length > 0) {
        this.loadDetail();
      }
    });
  }

  /** Every version, re-issued by its own retry. */
  protected loadList(): void {
    const application = this.application();
    this.listState.set(LOADING);
    this.api.declarations(application).then(
      (declarations) => this.listState.set(ready(declarations)),
      (error: unknown) => this.listState.set(failed(error)),
    );
  }

  /**
   * One version's document, re-issued by its own retry.
   *
   * A version this application never declared is a 404 rather than an empty document, and it is
   * drawn as the error it is: the listing beside it still stands, which is where a reader who
   * followed a stale link goes next.
   */
  protected loadDetail(): void {
    const application = this.application();
    const version = this.version();
    this.detailState.set(LOADING);
    this.api.declaration(application, version).then(
      (declaration) => this.detailState.set(ready(declaration)),
      (error: unknown) => this.detailState.set(failed(error)),
    );
  }
}
