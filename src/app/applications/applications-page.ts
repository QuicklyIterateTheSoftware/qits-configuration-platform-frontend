import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ApplicationEnvSummary, ApplicationSummary } from '../api/dto';
import { ConfigurationApi } from '../api/configuration-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { plural } from '../ui/format';
import { ConfigurationLinks } from '../ui/links';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * One row of the listing: the application, the tiers it is configured in, and the one number that
 * exists only as a door.
 *
 * Derived once in a `computed` rather than by calling functions from the template, so a row is
 * summed when the listing changes and not on every change detection — and so the aria-label the
 * total's link needs is a string on the row rather than an expression spelled in markup.
 */
interface ApplicationRow {
  readonly application: string;
  readonly envs: readonly ApplicationEnvSummary[];
  readonly total: number;
  readonly matrixLabel: string;
}

/**
 * The front door: every application this service holds configuration for, and the tiers each one is
 * configured in.
 *
 * **Load budget: one request, and nothing per row.** `GET /configuration/api/applications` answers
 * the name and one row per environment — the env, its entry count, its head revision — for every
 * application at once, so a table of forty applications costs what a table of one costs. Asking each
 * application for its entries to count them would turn one request into one per row and arrive at
 * the same numbers.
 *
 * **THE NUMBERS HANG OFF THE ENVIRONMENTS, and one aggregate on its own is the wrong shape.**
 * "qits-gateway has 11 entries" is a fact nobody can act on: it does not say whether prod is missing
 * the key dev has, which is the question an operator opens this listing to answer. So every row
 * draws its environments one per line with that tier's own count and head revision beside it, and
 * the aggregate is drawn only as the LINK to the matrix — the page where the same comparison is
 * complete, key by key. A number that could mislead is worth keeping only where it leads somewhere
 * that cannot.
 *
 * **That is also where the cross-env door lives, and it is a choice between two.** The matrix could
 * hang off each row here or off the application's own page, and it does both — but the row's link is
 * the one that matters, because the reader who needs it is the one looking at `dev 12 / prod 3` and
 * wondering which nine keys are missing. Making them open the application first would put a page in
 * front of the question this listing just raised.
 *
 * **The two numbers do not track each other, and now they do it per environment.** `entries` is what
 * that tier holds NOW; `headRevision` is a position in the append-only log, which is global to the
 * application rather than per-env — so it moves forward when an entry is deleted, and the distance
 * between two of an application's tiers is the writes the other tiers took. It says which tier was
 * written most recently, never how many times. Someone reading a tier at 3 entries and revision 240
 * as "3 entries, 240 writes" would think the row was a bug.
 *
 * **An application at zero entries is still listed, and that is the service's decision rather than
 * this table's.** "Where did my configuration go" is the question this listing most needs to be able
 * to answer, so a tier whose entries have all been deleted stays — at zero, with its head revision
 * moved forward, which is exactly how it says what happened. `envs` is never empty for the same
 * reason: an application is in this list because some tier of it holds, or once held, an entry.
 *
 * There is no create-an-application form, because there is no such thing: an application exists here
 * because it has an entry, and entries are written by the platform's own processes rather than by
 * this screen. A form here would create a name with nothing behind it, which the service has no row
 * for.
 *
 * **With a repository in scope this page is a doorway rather than a destination.** An operator who
 * arrived from that repository's sidebar wants its configuration, not a list to find it in — so
 * when the listing contains an application of that name the page replaces the address with it. It
 * REPLACES rather than pushes: the list was never a step the reader took, and leaving it in the
 * history would make Back bounce them straight forward again.
 *
 * The redirect lands on the env-LESS address on purpose, even though this page knows every tier the
 * application has. `applications/<name>` means "whichever tier this application has", the entries
 * page settles it against the same listing and says which one it settled on; picking a tier HERE, on
 * the reader's behalf, would be this page deciding that dev is what they came for.
 *
 * The redirect waits for the listing on purpose too. Navigating on the name alone would land on a
 * page for an application this service has nothing for, and the honest answer to "this repository
 * has no configuration" is this list with a line saying so.
 */
@Component({
  selector: 'app-applications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Async, Empty],
  styleUrls: ['../ui/page.css'],
  template: `
    <header class="head">
      <h1>Deployment configuration</h1>
    </header>
    <p class="lede">
      What each application on this platform is deployed with, in every environment it is configured
      in. Every entry here is read by qits-platform-deployments on that application's next
      deployment, and every change to one is kept.
    </p>

    <app-async
      [state]="state()"
      loadingLabel="Loading applications"
      errorLabel="Could not load the applications"
      (retry)="load()"
    />

    @if (unconfigured(); as repository) {
      <p class="note" role="status">
        {{ repository }} has no configuration of its own here. Everything this service holds is
        below.
      </p>
    }

    @if (state().kind === 'ready') {
      @if (rows().length === 0) {
        <app-empty
          message="No application has configuration here yet. An application appears in this list when its first entry is written."
        />
      } @else {
        <div class="scroll">
          <table>
            <caption>
              {{
                caption()
              }}. Each tier carries its own count: entries are what that tier holds now, and the
              head revision is a position in one write log shared by every tier, so it moves forward
              when an entry is deleted and says which tier was written most recently rather than how
              often. The total is a door to the matrix, where the tiers stand side by side key by
              key.
            </caption>
            <thead>
              <tr>
                <th scope="col">Application</th>
                <th scope="col">Environments</th>
                <th scope="col" class="num">Entries</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.application) {
                <tr>
                  <th scope="row">
                    <a [routerLink]="links.commands('applications', row.application)">{{
                      row.application
                    }}</a>
                  </th>
                  <td>
                    <ul class="envs">
                      @for (env of row.envs; track env.env) {
                        <li>
                          <a
                            class="env"
                            [routerLink]="
                              links.commands('applications', row.application, 'envs', env.env)
                            "
                            >{{ env.env }}</a
                          >
                          <span class="env-entries">{{
                            plural(env.entries, 'entry', 'entries')
                          }}</span>
                          <span class="env-rev subtle">rev {{ env.headRevision }}</span>
                        </li>
                      }
                    </ul>
                  </td>
                  <td class="num">
                    <a
                      class="total"
                      [routerLink]="links.commands('applications', row.application, 'matrix')"
                      [attr.aria-label]="row.matrixLabel"
                      >{{ row.total }}</a
                    >
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    <p class="note">
      This is not what a deployment is running — it is what its next deployment will carry. The
      deployer reads one application's entries for one environment per deployment and records the
      revision it deployed with.
    </p>
    <p class="note">
      These counts are the entries STORED for each tier, which is not the whole configuration a
      container receives. An application's declaration carries a default for keys nobody has
      overridden, and those defaults are stored nowhere here — the resolved view of one environment
      is where the two are drawn together.
    </p>
  `,
  styles: `
    /* The per-env breakdown inside a row. A list rather than a run of chips: the tiers of one
       application are read DOWN, against each other, and a wrapping row of chips puts dev and prod
       on different lines at some widths and the same line at others — which is exactly the
       comparison this column exists to make easy. */
    .envs {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .envs li {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.1rem 0;
    }

    /* Wide enough for the widest env name anybody uses (production) plus room, so the counts beside
       them line up down the column. Aligning them is what turns three rows into a comparison rather
       than three sentences. */
    .envs .env {
      display: inline-block;
      min-width: 6rem;
      color: #4338ca;
    }

    .envs .env-entries {
      font-variant-numeric: tabular-nums;
    }

    .envs .env-rev {
      font-size: 0.85em;
    }

    /* The aggregate. It is a link and it looks like one, because a bare number here would be the
       misleading half of this table standing on its own — see the note on the component. */
    .total {
      color: #4338ca;
    }
  `,
})
export class ApplicationsPage {
  private readonly api = inject(ConfigurationApi);
  private readonly router = inject(Router);
  protected readonly links = inject(ConfigurationLinks);

  protected readonly plural = plural;

  protected readonly state = signal<Loadable<readonly ApplicationSummary[]>>(LOADING);

  /** The scoped repository, once the listing has answered and does NOT contain it. */
  protected readonly unconfigured = signal<string | undefined>(undefined);

  protected readonly applications = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly rows = computed<readonly ApplicationRow[]>(() =>
    this.applications().map((application) => ({
      application: application.application,
      envs: application.envs,
      total: application.envs.reduce((sum, env) => sum + env.entries, 0),
      matrixLabel: `${application.application} in every environment, side by side`,
    })),
  );

  protected readonly caption = computed(() =>
    plural(this.rows().length, 'application', 'applications'),
  );

  constructor() {
    this.load();
  }

  /** The page's one request, re-issued by the retry button and by nothing else. */
  protected load(): void {
    this.state.set(LOADING);
    this.unconfigured.set(undefined);
    this.api.applications().then(
      (applications) => {
        this.state.set(ready(applications));
        this.settleScope(applications);
      },
      (error: unknown) => this.state.set(failed(error)),
    );
  }

  /**
   * Go to the scoped repository's own page, or say plainly that it has none.
   *
   * Matched by NAME and by nothing else: an application id here is the deployed application's name,
   * which is the repository's. There is no field on either side recording the link, so a repository
   * whose application is named differently falls to the note rather than to a wrong page.
   */
  private settleScope(applications: readonly ApplicationSummary[]): void {
    const repository = this.links.scope()?.repository;
    if (!repository) return;
    if (applications.some((application) => application.application === repository)) {
      void this.router.navigate(this.links.commands('applications', repository), {
        replaceUrl: true,
      });
      return;
    }
    this.unconfigured.set(repository);
  }
}
