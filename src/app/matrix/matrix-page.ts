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
import { QitsBadge, type QitsBadgeTone } from '@qits/ui-components';
import { ConfigurationApi } from '../api/configuration-api';
import type {
  ApplicationEnvSummary,
  ConfigurationEntry,
  Declaration,
  DeclarationSummary,
  DeclaredKey,
} from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { plural } from '../ui/format';
import { ConfigurationLinks } from '../ui/links';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { declaredDetail, sourceLabel, sourceOf, sourceTone, typeTone } from '../ui/source';

/**
 * What one key resolves to in one environment: which of the five states it is in, and the string a
 * container would be given for it.
 *
 * `token` is what divergence is computed on and never drawn — see {@link MatrixPage} for what it
 * means and why a default and an override holding the same string are not a difference.
 */
interface MatrixCell {
  readonly env: string;
  readonly label: string;
  readonly tone: QitsBadgeTone;
  readonly value: string | null;
  readonly token: string;
}

/** One key across every environment. */
interface MatrixRow {
  readonly key: string;
  readonly declared: DeclaredKey | undefined;
  readonly cells: readonly MatrixCell[];
  readonly diverges: boolean;
}

/** The two reads the grid is built from, once both have arrived. */
interface Grid {
  readonly entriesByEnv: ReadonlyMap<string, readonly ConfigurationEntry[]>;
  readonly declaration: Declaration | null;
}

/**
 * One application's configuration as a key × environment grid: every key it has anywhere, and what
 * each tier would give a container for it.
 *
 * **Load budget: two requests, then one per environment plus one — and that shape is the question
 * rather than a cost to apologise for.** The first wave is `GET /applications`, which is the only
 * place the set of environments an application exists in is written down, and `GET …/declarations`,
 * which names the document the defaults come from. The second wave is `GET …/envs/<env>/entries`
 * for every one of those environments, fired together, and `GET …/declarations/<version>` for the
 * declared keys. There is no route that answers several tiers at once and this page does not pretend
 * there is: asking one tier at a time, in a browser tab per environment, is exactly what this screen
 * exists to stop somebody doing by hand — and doing it in parallel, in one place, with the answers
 * lined up, is the whole of the improvement.
 *
 * **EACH CELL SAYS WHICH OF FIVE THINGS IT IS, and the wording comes from `ui/source.ts` rather than
 * from here.** An operator's own override, a value the bootstrap import wrote, the declared default
 * standing in where no tier set anything, an address the platform renders per environment, and
 * absent. The first four are `sourceOf` answering exactly as it answers on the resolved page, which
 * is the point of calling it: two screens that worked out the same fact separately are two screens
 * that will eventually disagree, and the one an operator happens to have open would decide what they
 * believe.
 *
 * **Absent is this page's own fifth state and is deliberately NOT `sourceOf`'s "unexplained".** That
 * fourth answer is an alarm about a resolved map holding a key nothing accounts for, which cannot
 * happen within one instant of the store. Here the keys come from the union of the declaration and
 * the stored rows rather than from a resolved map, so "no entry in this tier and no default to fall
 * back on" is the ordinary answer — the container is given no variable rather than an empty one —
 * and drawing the commonest cell in the grid as a fault would make the grid unreadable.
 *
 * **A serviceAddress row is its own state because an operator cannot change it.** The platform
 * renders that address per environment from the declaration, a stored row on such a key is ignored
 * in favour of it, and the entries read reports that row orphaned for the same reason. The cell
 * shows what the declaration names — the service and the port — because the host half depends on
 * which plane the addressed application deploys onto, which is a fact only a resolved read for one
 * environment can supply.
 *
 * **DIVERGENCE IS DEFINED ON WHAT A CONTAINER WOULD RECEIVE, and it is not an error.** A row is
 * marked when its environments do not all arrive at the same answer, where the answer is the string
 * the tier would supply and absent is its own distinct answer — so "set in dev, absent in prod"
 * diverges, and so does "1000 in dev, 2000 in prod". Two tiers holding the same string do NOT
 * diverge even when one of them got it from an operator and the other from the default, because how
 * a value got there is not a difference in what runs. A serviceAddress row never diverges: one
 * declaration renders it in every tier, and the per-environment host this page cannot see is the
 * way it is MEANT to differ. Tiers are supposed to be different — a production database URL that
 * matched dev's would be the alarming row — so the marker is drawn as information and never as a
 * fault. It says where to look when one tier misbehaves, and nothing more.
 *
 * **THE DEFAULTS COME FROM THE NEWEST DECLARATION AND THAT IS NOT A CLAIM ABOUT ANY ENVIRONMENT.**
 * Which declaration a running deployment resolved against is recorded at that deployment's cutover
 * and this service does not hold it. So a default in this grid is what a deployment started now
 * would fall back on, in every tier at once, and never what a tier is running today. The page says
 * so in its own sentence, next to the version it used.
 *
 * **Nothing here writes.** Every value in the grid arrived through a GET, and the row an operator
 * would want to change is changed by the process that owns it.
 */
@Component({
  selector: 'app-matrix-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QitsBadge, Async, Empty],
  styleUrls: ['../ui/page.css'],
  template: `
    <p class="crumbs">
      <a [routerLink]="links.commands()">Applications</a>
      <span class="sep">/</span>
      <a [routerLink]="links.commands('applications', application())">{{ application() }}</a>
      <span class="sep">/</span>
      <span>Every environment</span>
    </p>

    <header class="head">
      <h1>{{ application() }} — every environment</h1>
    </header>
    <p class="lede">
      Every key {{ application() }} has anywhere, and what each tier would give a container for it.
      One column per environment this service holds it in.
    </p>

    <app-async
      [state]="directory()"
      loadingLabel="Loading this application's environments"
      errorLabel="Could not load this application's environments"
      (retry)="loadDirectory()"
    />

    <app-async
      [state]="gridState()"
      loadingLabel="Loading every environment's entries"
      errorLabel="Could not build the matrix"
      (retry)="loadGrid()"
    />

    @if (directory().kind === 'ready' && gridState().kind === 'ready') {
      <p class="caveat" role="note">
        @if (declaredVersion(); as version) {
          Defaults below are from declaration <strong>{{ version }}</strong
          >, the newest this application has declared. Newest is not a claim about what is running:
          which declaration a running deployment resolved against is recorded at that deployment's
          cutover and this service does not hold it, so no column here can tell you which version
          that tier settled on.
        } @else {
          This application has declared nothing, so every cell below is a stored row or nothing at
          all. There are no defaults to fall back on and no addresses for the platform to render.
        }
      </p>

      @if (envs().length === 0) {
        <app-empty
          message="This service holds no configuration for this application in any environment, so there are no columns to compare."
        />
      } @else if (rows().length === 0) {
        <app-empty
          message="This application exists here with no keys at all — nothing stored in any environment, and nothing declared. It will start with whatever its image and the deployer's own defaults give it."
        />
      } @else {
        <div class="scroll">
          <table>
            <caption>
              {{
                caption()
              }}. A row marked
              <em>differs</em>
              does not arrive at the same answer in every tier — which is usually correct and always
              worth knowing, never an error in itself.
            </caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                @for (summary of envs(); track summary.env) {
                  <th scope="col">
                    <a
                      [routerLink]="
                        links.commands('applications', application(), 'envs', summary.env)
                      "
                      >{{ summary.env }}</a
                    >
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.key) {
                <tr [class.diverges]="row.diverges">
                  <th scope="row" class="key">
                    <span class="mono key-name">{{ row.key }}</span>
                    <span class="key-tags">
                      @if (row.declared; as declared) {
                        <qits-badge [label]="declared.type" [tone]="typeTone(declared.type)" />
                        @if (declaredDetail(declared); as detail) {
                          <span class="detail mono subtle">{{ detail }}</span>
                        }
                      } @else {
                        <span class="subtle undeclared">not declared</span>
                      }
                      @if (row.diverges) {
                        <qits-badge label="differs" tone="info" />
                      }
                    </span>
                  </th>
                  @for (cell of row.cells; track cell.env) {
                    <td class="value mono cell">
                      @if (cell.value === null) {
                        <span class="subtle absent">not set</span>
                      } @else if (cell.value.length === 0) {
                        <span class="subtle empty-value">(empty)</span>
                      } @else {
                        {{ cell.value }}
                      }
                      <span class="cell-source">
                        <qits-badge [label]="cell.label" [tone]="cell.tone" />
                      </span>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    <p class="note">
      An absent cell is not an empty one. A key with no stored row and no declared default is left
      out of that environment's resolved map entirely, so the container is given no variable rather
      than a variable holding nothing — which is the difference between a program falling back to
      its own default and a program starting with the empty string.
    </p>
    <p class="note">
      This view is read-only. Every entry in it is written through the API by the platform's own
      processes, each write part of a larger operation with more to do afterwards.
    </p>
  `,
  styles: `
    /* The caveat is drawn as a note and not as a warning: nothing is wrong, there is simply a
       question this grid cannot answer, and colouring it as a fault would train a reader to skip
       the one paragraph that stops them misreading every column. */
    .caveat {
      margin: 0 0 1rem;
      padding: 0.5rem 0.75rem;
      border-left: 3px solid #d1d5db;
      color: #4b5563;
      font-size: 0.88rem;
    }

    thead a {
      color: #4338ca;
    }

    /* The key column. Wide enough for env.QITS_SOMETHING_LONG and its type badge, wrapping rather
       than widening a table that already has one column per environment. */
    .key {
      font-weight: 500;
      max-width: 24rem;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .key-name {
      display: block;
    }
    .key-tags {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.2rem;
      font-weight: 400;
    }
    .undeclared {
      font-style: italic;
      font-size: 0.85em;
    }
    .detail {
      font-size: 0.85em;
    }

    /* THE DIVERGENCE MARKER IS A RULE DOWN THE ROW, not a fill behind it. A tinted row reads as a
       failed row — this application's operators have spent years reading red and amber that way on
       every other screen of this platform — and a tier legitimately differing from another tier is
       the most ordinary thing in this table. A rule says "these are not the same" and says nothing
       about whether they ought to be. */
    tr.diverges > * {
      border-left: 3px solid #93c5fd;
      padding-left: 0.5rem;
    }
    tr.diverges > *:first-child {
      border-left-color: #3b82f6;
    }

    /* A cell holds a stored VALUE and nothing here truncates one — see .value in ui/page.css. The
       source badge sits under it rather than beside it so that a long value and a short one line
       their badges up, which is what makes a column of them scannable. */
    .cell {
      min-width: 10rem;
    }
    .cell-source {
      display: block;
      margin-top: 0.2rem;
    }
    .absent,
    .empty-value {
      font-style: italic;
    }
  `,
})
export class MatrixPage {
  protected readonly links = inject(ConfigurationLinks);

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ConfigurationApi);

  protected readonly typeTone = typeTone;
  protected readonly declaredDetail = declaredDetail;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly application = computed(() => this.params().get('application') ?? '');

  private readonly envsState = signal<Loadable<readonly ApplicationEnvSummary[]>>(LOADING);
  private readonly declarationsState = signal<Loadable<readonly DeclarationSummary[]>>(LOADING);

  /** The per-env entries and the declared keys, which only make a grid together. */
  protected readonly gridState = signal<Loadable<Grid>>(LOADING);

  /**
   * The two listings that say what the grid is SHAPED like: which columns it has, and which document
   * its defaults come from.
   *
   * They are one panel because neither is useful alone here — a column set with no declaration would
   * draw every declared-but-unset key as if the application had never mentioned it, and a
   * declaration with no column set would have nowhere to draw anything.
   */
  protected readonly directory = computed<Loadable<readonly ApplicationEnvSummary[]>>(() => {
    const envs = this.envsState();
    if (envs.kind === 'error') return envs;
    const declarations = this.declarationsState();
    if (declarations.kind === 'error') return declarations;
    return envs.kind === 'ready' && declarations.kind === 'ready' ? envs : LOADING;
  });

  /**
   * The columns, in the listing's order.
   *
   * The service sorts `envs` by name and that order is kept rather than re-imposed: an operator
   * reading two of these pages side by side needs the columns in the same places on both, and the
   * one thing guaranteed to put them there is not having a second opinion about it.
   */
  protected readonly envs = computed(() => {
    const state = this.envsState();
    return state.kind === 'ready' ? state.value : [];
  });

  /** The newest declaration, which is where every default and every declared type in the grid comes from. */
  private readonly governing = computed(() => {
    const state = this.declarationsState();
    if (state.kind !== 'ready') return undefined;
    return state.value.find((summary) => summary.governing) ?? state.value[0];
  });

  /** The version the defaults came from, drawn beside them so the grid names its own source. */
  protected readonly declaredVersion = computed(() => {
    const state = this.gridState();
    return state.kind === 'ready' ? (state.value.declaration?.version ?? '') : '';
  });

  protected readonly rows = computed<readonly MatrixRow[]>(() => {
    const grid = this.gridState();
    return grid.kind === 'ready' ? this.rowsOf(this.envs(), grid.value) : [];
  });

  protected readonly caption = computed(
    () =>
      `${plural(this.rows().length, 'key', 'keys')} across ` +
      `${plural(this.envs().length, 'environment', 'environments')}`,
  );

  constructor() {
    // The application is a path segment, so moving between two applications' matrices REUSES this
    // component rather than rebuilding it. Reading it as a signal is what makes that a fetch.
    effect(() => {
      if (this.application().length > 0) {
        this.loadDirectory();
      }
    });

    // The second wave. It cannot start before the first: the environments it fetches entries for are
    // named by the applications listing, and the declaration it fetches is named by the declarations
    // listing. Neither is knowable from the address alone.
    effect(() => {
      if (this.directory().kind !== 'ready') return;
      this.loadGrid();
    });
  }

  /** The column set and the version list, together. */
  protected loadDirectory(): void {
    const application = this.application();
    this.envsState.set(LOADING);
    this.declarationsState.set(LOADING);
    this.api.envsOf(application).then(
      (envs) => this.envsState.set(ready(envs)),
      (error: unknown) => this.envsState.set(failed(error)),
    );
    this.api.declarations(application).then(
      (declarations) => this.declarationsState.set(ready(declarations)),
      (error: unknown) => this.declarationsState.set(failed(error)),
    );
  }

  /**
   * One entries read per environment, fired together, and the declaration beside them.
   *
   * `Promise.all` rather than a loop with awaits in it, and the difference is the whole point of the
   * page: a serial version would take as long as there are tiers, on a screen whose reason to exist
   * is that opening the tiers one at a time is slow. One failed environment fails the grid — a
   * matrix missing a column while looking complete would be read as "prod has none of these keys",
   * which is the worst sentence this page could accidentally say.
   */
  protected loadGrid(): void {
    const application = this.application();
    const envs = this.envs();
    const governing = this.governing();
    this.gridState.set(LOADING);
    Promise.all([
      Promise.all(
        envs.map(
          async (summary) =>
            [summary.env, await this.api.entries(application, summary.env)] as const,
        ),
      ),
      governing ? this.api.declaration(application, governing.version) : Promise.resolve(null),
    ]).then(
      ([entries, declaration]) =>
        this.gridState.set(ready({ entriesByEnv: new Map(entries), declaration })),
      (error: unknown) => this.gridState.set(failed(error)),
    );
  }

  /**
   * The grid itself: one row per key, one cell per environment.
   *
   * **The rows are the UNION of every environment's stored keys and every declared key, sorted.** A
   * key stored only in dev has to have a row or the grid could not show that prod is missing it,
   * which is the question this page is most often opened for; a key declared and stored nowhere has
   * to have a row because its default is what every tier would receive, and a grid that omitted it
   * would be a grid claiming the key does not exist. Sorting is this page's own — the keys arrive
   * from several reads and there is no service order spanning them.
   */
  private rowsOf(envs: readonly ApplicationEnvSummary[], grid: Grid): readonly MatrixRow[] {
    const declaredByKey = new Map((grid.declaration?.keys ?? []).map((key) => [key.key, key]));
    const keys = new Set<string>(declaredByKey.keys());
    for (const entries of grid.entriesByEnv.values()) {
      for (const entry of entries) {
        keys.add(entry.key);
      }
    }
    return [...keys].sort().map((key) => {
      const declared = declaredByKey.get(key);
      const cells = envs.map((summary) =>
        this.cellOf(key, summary.env, grid.entriesByEnv.get(summary.env) ?? [], declared),
      );
      return {
        key,
        declared,
        cells,
        diverges: new Set(cells.map((cell) => cell.token)).size > 1,
      };
    });
  }

  /**
   * One cell: which of the five states this key is in for this environment, and what it would hand a
   * container.
   *
   * The four value-bearing states are `sourceOf`'s, asked exactly as the resolved page asks it, so
   * the two screens cannot drift apart in either wording or tone. Its fourth answer — neither an
   * entry nor a default — is the absent cell here rather than an alarm, for the reason set out on
   * the component.
   */
  private cellOf(
    key: string,
    env: string,
    entries: readonly ConfigurationEntry[],
    declared: DeclaredKey | undefined,
  ): MatrixCell {
    const entry = entries.find((candidate) => candidate.key === key);
    const source = sourceOf(entry, declared);
    if (source === 'rendered' && declared) {
      // One declaration renders this in every tier, and the host half — which depends on the
      // addressed application's own plane — exists only in a resolved read for one environment. So
      // the cell shows what IS known here and the row is uniform by construction.
      return {
        env,
        label: sourceLabel(source),
        tone: sourceTone(source),
        value: declaredDetail(declared),
        token: '#rendered',
      };
    }
    if (source === 'operator' || source === 'imported') {
      const value = entry?.value ?? '';
      return {
        env,
        label: sourceLabel(source),
        tone: sourceTone(source),
        value,
        token: `=${value}`,
      };
    }
    if (source === 'default' && declared?.defaultValue != null) {
      const value = declared.defaultValue;
      return {
        env,
        label: sourceLabel(source),
        tone: sourceTone(source),
        value,
        token: `=${value}`,
      };
    }
    // Absent: no stored row and nothing declared to fall back on. Every value's token is spelled
    // `=<value>` and the two states that are not values are spelled with a `#`, so no value can
    // collide with either — which is what makes "set in dev, absent in prod" a divergence, including
    // when the value in dev is the empty string.
    return { env, label: 'absent', tone: 'neutral', value: null, token: '#absent' };
  }
}
