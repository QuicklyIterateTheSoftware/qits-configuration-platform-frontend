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
import type { ApplicationEnvSummary, ConfigurationRevision } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, actor, formatInstant, plural } from '../ui/format';
import { LOADING, IDLE, failed, ready, type Loadable } from '../ui/loadable';
import { ConfigurationLinks } from '../ui/links';

/**
 * What has been written to one application's configuration IN ONE ENVIRONMENT, newest first.
 *
 * **The env is the first fact on this page, and it used not to exist.** The store held one tier and
 * a history was simply "this application's writes"; it holds every tier now, so the same key appears
 * in this log once per environment and a row that cannot be attributed to a tier is a row a reader
 * will attribute to the wrong one. The env is in the address, in the heading and in a picker, which
 * is three sayings of the same thing on purpose — the address is what gets pasted into a ticket, the
 * heading is what gets read, and the picker is what gets used.
 *
 * **This page is mounted TWICE and neither spelling is a redirect.** `…/envs/<env>/history` names a
 * tier; `…/history` means "whichever tier this application has", which is the honest address for a
 * link written before anybody knew the answer — a sidebar entry, a note from last month. The env-less
 * form settles against the applications listing, shows what it settled on, AND LEAVES THE URL ALONE:
 * rewriting it would turn every such link into a lie about what its author asked for, and would make
 * the Back button walk through an address the reader never chose.
 *
 * **Load budget: two requests, and nothing per row.** `GET /applications` is the only place on the
 * wire that says which tiers an application even has, so it is what fills the picker and what the
 * env-less spelling settles against; `GET …/envs/<env>/history` answers the whole log for that tier.
 * With the env in the address the two go out together, because the history does not need the listing
 * to know which tier it is asking about. Without it the history waits, which is not a stall but the
 * page finding out what the address left open.
 *
 * **The two reads carry separate {@link Loadable}s.** A listing that failed must not erase a history
 * that arrived: with the env in the address the table is still exactly right, and all that is lost is
 * the ability to move to another tier.
 *
 * **The order is the service's, not this page's.** `seq` is the append-only log's own sequence, and
 * the rows arrive newest first already. Re-sorting them here — by timestamp, say — would disagree
 * with the store the moment two writes share an instant, and the sequence is the thing the deployer
 * quotes when it records what it deployed with.
 *
 * **The seqs are GLOBAL to the log rather than per-env, and the page says so.** One environment's
 * write takes the next number whichever tier it landed in, so this list runs 41, 38, 37 with nothing
 * missing — 40 and 39 are another tier's. A reader who took the gaps for lost rows would be reading
 * an alarm into the most ordinary fact about a shared log.
 *
 * **A deletion is a row with no value, and it is drawn as a word rather than as a blank.** An entry
 * may hold the empty string, so `value: null` alone could not tell a deletion from a blanking — the
 * service carries a `deleted` flag beside it for exactly that reason, and this table reads the flag.
 * A blank cell would have merged the two most different events in this log.
 *
 * **Nothing here restores a revision.** The store has no such route, and a button that re-PUT an old
 * value would be a restore that quietly wrote a NEW revision — a different thing, worth its own
 * decision, and not one to smuggle in behind a familiar word. Copying a value out of a row and
 * writing it on the entries page does the same work and says what it is doing.
 */
@Component({
  selector: 'app-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QitsBadge, QitsPicker, Async, Empty],
  styleUrls: ['../ui/page.css'],
  template: `
    <p class="crumbs">
      <a [routerLink]="links.commands()">Applications</a>
      <span class="sep">/</span>
      <a [routerLink]="entriesCommands()">{{ application() }}</a>
      <span class="sep">/</span>
      <span>History</span>
    </p>

    <header class="head">
      <div class="title">
        <h1>{{ application() }} — history</h1>
        @if (env(); as settled) {
          <qits-badge [label]="settled" tone="info" />
        }
      </div>
      <div class="tier">
        <app-async
          [state]="envsState()"
          loadingLabel="Loading environments"
          errorLabel="Could not load this application's environments"
          (retry)="loadEnvs()"
        />
        @if (envOptions().length > 0) {
          <qits-picker
            [options]="envOptions()"
            [value]="env()"
            (valueChange)="pickEnv($event)"
            ariaLabel="Environment"
            placeholder="Pick an environment"
          />
        }
      </div>
    </header>
    <p class="lede">
      Every write to this application's configuration in one environment, newest first. Which tier
      is on screen is in the address above, and the picker moves between them.
    </p>

    @if (env().length === 0) {
      @if (envsState().kind === 'ready') {
        <app-empty
          message="This application is configured in no environment, so there is no history to show. It appears in a tier when its first entry is written there."
        />
      }
    } @else {
      <app-async
        [state]="state()"
        loadingLabel="Loading history"
        errorLabel="Could not load the history"
        (retry)="load()"
      />

      @if (state().kind === 'ready') {
        @if (revisions().length === 0) {
          <app-empty
            message="Nothing has been written for this application in this environment. Its history here begins with its first entry."
          />
        } @else {
          <div class="scroll">
            <table>
              <caption>
                {{
                  caption()
                }}
                in
                {{
                  env()
                }}. A deleted entry keeps what it held — that is what makes an accidental delete
                answerable rather than merely regrettable.
              </caption>
              <thead>
                <tr>
                  <th scope="col" class="num">Revision</th>
                  <th scope="col">Key</th>
                  <th scope="col">Value</th>
                  <th scope="col">By</th>
                  <th scope="col">At</th>
                </tr>
              </thead>
              <tbody>
                @for (revision of revisions(); track revision.seq) {
                  <tr>
                    <th scope="row" class="num">{{ revision.seq }}</th>
                    <td class="mono key">{{ revision.key }}</td>
                    <td class="value mono">
                      @if (revision.deleted) {
                        <span class="deleted">deleted</span>
                      } @else if (revision.value === null || revision.value.length === 0) {
                        <span class="subtle empty-value">(empty)</span>
                      } @else {
                        {{ revision.value }}
                      }
                    </td>
                    <td class="subtle">{{ actor(revision.updatedBy) }}</td>
                    <td class="subtle">{{ formatInstant(revision.updatedAt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }

    <p class="note">
      The revision numbers are the whole log's, not this environment's. Every tier's writes take
      their number from the same sequence, so a jump between two rows here is another environment's
      write and never a row missing from this one.
    </p>
    <p class="note">
      A write that changed nothing is not in this log. Setting an entry to the value it already
      holds stores no revision, which is what keeps a re-run of a seeding script free and this list
      a record of changes rather than of runs.
    </p>
  `,
  styles: `
    /* The heading and the tier control are the two halves of the page's own header. \`.head\` in
       ui/page.css already pushes them apart; this only keeps the env badge on the heading's
       baseline instead of on a line of its own, where it would read as a caption rather than as
       part of the title. */
    .title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    /* The picker is given a floor rather than a width. Its bar collapses to the width of the env
       name once one is settled, and a control that changed size every time the reader moved between
       \`dev\` and \`integration\` would make the header twitch on every navigation. */
    .tier {
      min-width: 12rem;
    }
    .key {
      max-width: 22rem;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .deleted {
      color: #b91c1c;
      font-style: italic;
    }
    .empty-value {
      font-style: italic;
    }
  `,
})
export class HistoryPage {
  protected readonly links = inject(ConfigurationLinks);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ConfigurationApi);

  protected readonly NONE = NONE;
  protected readonly actor = actor;
  protected readonly formatInstant = formatInstant;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly application = computed(() => this.params().get('application') ?? '');

  /**
   * The env the ADDRESS names, empty where it names none.
   *
   * Kept apart from {@link env} because the difference between the two is the whole of the env-less
   * spelling: what the reader asked for, and what the page settled on for them.
   */
  private readonly addressedEnv = computed(() => this.params().get('env') ?? '');

  /** Which tiers this application is configured in — the picker's options, and the settling. */
  protected readonly envsState = signal<Loadable<readonly ApplicationEnvSummary[]>>(LOADING);

  private readonly envs = computed(() => {
    const state = this.envsState();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * The tier on screen: the one the address names, or the first the listing gives.
   *
   * **First rather than a favourite.** The listing arrives sorted by env name and the service is
   * where that order is decided, so the page picks the head of it and nothing cleverer — a client
   * that preferred `prod`, or the tier with the most entries, would be a client whose answer to
   * "whichever tier this application has" changed with the data underneath it.
   *
   * It is empty while the listing is still out and for an application configured in no tier at all,
   * which is what the reads below wait on rather than firing at an env of `''`.
   */
  protected readonly env = computed(() => {
    const addressed = this.addressedEnv();
    return addressed.length > 0 ? addressed : (this.envs()[0]?.env ?? '');
  });

  /**
   * What the picker offers: the env name and nothing else.
   *
   * The listing carries an entry count and a head revision per tier and neither is in the label. The
   * picker's job is to say which tiers exist and which one is being read; a number in it would
   * compete with the row count this page's own caption already gives, and the two count different
   * things.
   */
  protected readonly envOptions = computed<readonly QitsPickerOption<string>[]>(() =>
    this.envs().map((summary) => ({ value: summary.env, label: summary.env })),
  );

  /**
   * The log. **IDLE rather than LOADING until an env is settled**, because a shimmer is a promise
   * that something is on its way — and before the listing answers, nothing is.
   */
  protected readonly state = signal<Loadable<readonly ConfigurationRevision[]>>(IDLE);

  protected readonly revisions = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly caption = computed(() =>
    plural(this.revisions().length, 'recorded write', 'recorded writes'),
  );

  /**
   * The way back to the entries, env-addressed wherever a tier is settled.
   *
   * A breadcrumb that dropped the env would send a reader who arrived at prod's history to whichever
   * tier the entries page settles on for itself — the same trap this page exists to close, one link
   * further along.
   */
  protected readonly entriesCommands = computed(() => {
    const application = this.application();
    const env = this.env();
    return env.length > 0
      ? this.links.commands('applications', application, 'envs', env)
      : this.links.commands('applications', application);
  });

  constructor() {
    // The application is a path segment, so this component is reused across two applications'
    // histories. Reading it as a signal is what makes that navigation a fetch. The listing depends
    // on the application ALONE, so moving between two tiers of one application re-reads the history
    // and leaves the picker's own request alone.
    effect(() => {
      const application = this.application();
      if (application.length > 0) {
        this.loadEnvs();
      }
    });

    // The history depends on both, and `env` is a computed over the listing — which is what makes
    // the env-less spelling work without a second code path: the effect runs once with no env and
    // does nothing, then again the moment the listing settles one.
    effect(() => {
      const application = this.application();
      const env = this.env();
      if (application.length > 0 && env.length > 0) {
        this.load();
      }
    });
  }

  /** The picker's options and the env-less spelling's answer, re-issued by its own retry. */
  protected loadEnvs(): void {
    const application = this.application();
    this.envsState.set(LOADING);
    this.api.envsOf(application).then(
      (envs) => this.envsState.set(ready(envs)),
      (error: unknown) => this.envsState.set(failed(error)),
    );
  }

  /** The log for the settled env, re-issued by the retry button. */
  protected load(): void {
    const application = this.application();
    const env = this.env();
    this.state.set(LOADING);
    this.api.history(application, env).then(
      (revisions) => this.state.set(ready(revisions)),
      (error: unknown) => this.state.set(failed(error)),
    );
  }

  /**
   * Move to another tier's history — **a PUSH, because the reader chose it.** The env-less form's
   * settling is the page answering a question the address left open and gets no history entry; a
   * pick is a step somebody took, and Back has to undo it.
   *
   * **A cleared pick navigates nowhere.** The picker's clear button exists to put the list of tiers
   * back on screen, and this page always has a settled env, so there is no un-chosen state to go to:
   * navigating to the env-less spelling would take the reader on a longer road to the tier they are
   * already on. Clearing shows the choices; choosing is what moves.
   */
  protected pickEnv(env: string | undefined): void {
    const application = this.application();
    if (!env || application.length === 0 || env === this.env()) {
      return;
    }
    void this.router.navigate(
      this.links.commands('applications', application, 'envs', env, 'history'),
    );
  }
}
