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
import {
  QitsBadge,
  QitsPicker,
  type QitsBadgeTone,
  type QitsPickerOption,
} from '@qits/ui-components';
import { ConfigurationApi } from '../api/configuration-api';
import type { ApplicationEnvSummary, ConfigurationEntry, Declaration } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, actor, formatInstant, plural } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { ConfigurationLinks } from '../ui/links';
import { declaredDetail, isSystemOnly, sourceLabel, sourceTone, typeTone } from '../ui/source';

/**
 * One drawn row: the stored entry, and everything the governing declaration has to say about its
 * key.
 *
 * Assembled in a `computed` rather than looked up from the template, because every one of these
 * fields is a lookup into the declaration's key map and a template that asked four times per row
 * would do that work on every change detection. It also keeps the markup free of the joining rule
 * itself, which is the part worth reading in one place.
 */
interface EntryRow {
  readonly entry: ConfigurationEntry;
  /** The declared type, or `''` for a key the governing declaration does not spell. */
  readonly type: string;
  readonly typeTone: QitsBadgeTone;
  /** True where the platform renders this key's value and a stored row is ignored. */
  readonly systemOnly: boolean;
  /** `service:port` for a `serviceAddress` — the two halves the rendered host is built from. */
  readonly address: string;
  /** The word for `entryClass`, and the tone that word is drawn in. */
  readonly classLabel: string;
  readonly classTone: QitsBadgeTone;
}

/**
 * One application's stored configuration in ONE environment, as it is stored now.
 *
 * **This page reads and never writes, and that is a decision rather than an omission.** The entries
 * are system state: the platform's own processes write them through the API — a deployment, a
 * bootstrap import, a service that learns its own address — and every one of those writes is part of
 * a larger operation that has more to do afterwards. A hand edit in a browser lands in the middle of
 * that with none of the rest of it, so the screen offers no way to make one. The posture is said on
 * the page too, under the heading, because a table without buttons otherwise reads as a table whose
 * buttons have not loaded. The env picker is the one control here and it navigates; it changes
 * nothing.
 *
 * **THE ENV IS PART OF THE ADDRESS, and this component serves both spellings of it.**
 * `applications/<app>/envs/<env>` names a tier outright. `applications/<app>` names none, which
 * means "whichever tier this application has" — the honest address for a link written before anybody
 * knew the answer — and the page SETTLES it against the applications listing, which is the only
 * place on the wire that says which tiers exist. Settling shows the tier in the picker and leaves
 * the URL alone: rewriting it would turn a deliberate "whichever" into a redirect, and a reader who
 * pressed Back would be bounced straight forward again.
 *
 * **Load budget: four requests, and nothing per row.**
 *
 * 1. `GET /applications` — the env directory. Nothing else on the wire says which tiers this
 *    application has, so the picker's options and the env-less spelling's answer both come from it.
 * 2. `GET …/envs/<env>/entries` — the table. Every column of it comes off the row it draws.
 * 3. `GET …/declarations` — which version this application is judged against. `governing` is the
 *    intake log's decision and cannot be worked out from version ordering here.
 * 4. `GET …/declarations/<governing>` — the declared keys, which is where a key's TYPE comes from.
 *    Skipped entirely when the application has declared nothing.
 *
 * Three of the four are the price of drawing a type beside a value, and it is worth paying once per
 * page: the alternative is a table where `serviceAddress` looks like every other row until a
 * deployment disagrees with it. Moving between tiers re-reads only the table — the declaration
 * governs the application rather than one of its environments.
 *
 * **A failed declaration read does not blank the table, and the two panels are separate `Loadable`s
 * for exactly that reason.** A table with no type badges is strictly better than no table: the keys,
 * the values and who wrote them are what an operator came for, and they are all in hand. The
 * declaration's failure is drawn where the badges would have come from, with its own retry.
 *
 * **`orphaned` comes off the wire and is drawn as a marker rather than inferred here.** The service
 * computes it at read time against the governing declaration and stores it nowhere, and it covers
 * two different causes with one meaning: the key is not declared at all, or it is declared a
 * `serviceAddress` whose stored row the platform ignores in favour of the address it renders. Both
 * say the same thing to a person — this row is not reaching the container — and neither is an error
 * that anything cleans up.
 *
 * **THE VALUE IS THE POINT OF THIS SCREEN, so nothing here truncates one.** These values are mount
 * specifications, alias lists, URLs with query strings, occasionally something very long, and an
 * operator reads them to answer "what will this deployment run with". A cell that clipped at 60
 * characters with an ellipsis would be a screen that says something false about a deployment. The
 * table wraps instead — see `.value` in ui/page.css.
 *
 * **What this table is NOT is the configuration the container receives.** It is the overrides: a
 * declared default is what the application ships with and is stored nowhere here, a row on this page
 * overrides that default or holds a key that has none, and deleting a row returns the key to its
 * default rather than removing it. The two together are the resolved view, which is a link away and
 * said again in the note at the foot.
 *
 * **What this page cannot tell you is when a change takes effect.** The deployer reads an
 * application's entries once per deployment, so a write reaches a running container on its next
 * deployment and not before. The note at the foot says so, because an operator who assumed otherwise
 * would go looking for a bug in the deployer.
 */
@Component({
  selector: 'app-entries-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QitsBadge, QitsPicker, Async, Empty],
  templateUrl: './entries-page.html',
  styleUrls: ['../ui/page.css', './entries-page.css'],
})
export class EntriesPage {
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

  /**
   * The application, as the path segment spells it. It is not validated here: a name the service
   * refuses answers 400, which is this page's own state rather than a routing decision, and a name
   * nobody has configured answers 200 with an empty list rather than a 404.
   */
  protected readonly application = computed(() => this.params().get('application') ?? '');

  /**
   * The env the ADDRESS names, empty for the env-less spelling. Kept apart from {@link env} because
   * the difference between the two is what the page has to say out loud: one is what the reader
   * asked for, the other is what the page settled on.
   */
  protected readonly routeEnv = computed(() => this.params().get('env') ?? '');

  /** The env directory. Its failure costs the picker, and the table only where it was settling. */
  protected readonly envsState = signal<Loadable<readonly ApplicationEnvSummary[]>>(LOADING);

  protected readonly envs = computed(() => {
    const state = this.envsState();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * The env on screen: the one the address names, or — for the env-less spelling — the FIRST the
   * listing gives.
   *
   * First is not arbitrary: the service sorts `envs` by name, so this is stable across reads and
   * across readers rather than being whichever tier the store happened to answer with. It is empty
   * until the directory answers, and every read here is guarded on that.
   */
  protected readonly env = computed(() => this.routeEnv() || (this.envs()[0]?.env ?? ''));

  /** True where the page chose the env rather than the address naming it. Said on the page. */
  protected readonly settled = computed(
    () => this.routeEnv().length === 0 && this.env().length > 0,
  );

  /**
   * What the picker offers, with each tier's stored count beside its name.
   *
   * The count is on the option on purpose: an operator switching to prod to find out whether it
   * holds anything can read the answer before switching, and a tier at zero is the single most
   * common thing this page is opened to discover.
   */
  protected readonly envOptions = computed<readonly QitsPickerOption<string>[]>(() =>
    this.envs().map((summary) => ({
      value: summary.env,
      label: `${summary.env} — ${plural(summary.entries, 'entry', 'entries')}`,
    })),
  );

  /**
   * What the picker is showing, which is the settled env until the reader touches it.
   *
   * It is a signal of its own rather than the `env()` computed bound straight in, because the picker
   * has a state this page does not: cleared, which is how it puts its list back so another tier can
   * be chosen. Binding `env()` one-way would leave that cleared list open forever whenever the
   * reader cleared it and then re-picked the tier they were already on.
   *
   * An address naming a tier the listing does not know leaves this holding a value no option
   * matches, and the picker answers that by showing its list — which is the right screen for it: the
   * tiers it could offer, none of them claimed to be the one on screen.
   */
  protected readonly picked = signal<string | undefined>(undefined);

  /** The table. Its failure is the page's, and the panel below it stays. */
  protected readonly state = signal<Loadable<readonly ConfigurationEntry[]>>(LOADING);

  protected readonly entries = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * The governing declaration, or `null` where this application has declared nothing.
   *
   * `null` is a READY state and not an error: an application that has never run the pipeline that
   * posts a declaration has no document to be judged against, every one of its entries is an
   * override of nothing, and that is an ordinary thing for this page to draw.
   */
  protected readonly declarationState = signal<Loadable<Declaration | null>>(LOADING);

  protected readonly declaration = computed(() => {
    const state = this.declarationState();
    return state.kind === 'ready' ? state.value : null;
  });

  /** key → what the declaration says about it. Built once per read rather than per row. */
  private readonly declaredKeys = computed(
    () => new Map((this.declaration()?.keys ?? []).map((declared) => [declared.key, declared])),
  );

  protected readonly rows = computed<readonly EntryRow[]>(() => {
    const declared = this.declaredKeys();
    return this.entries().map((entry) => {
      const key = declared.get(entry.key);
      // `plain` is the WRITER's own word — the wire's name for "somebody set this", as opposed to
      // `imported`, which the bootstrap stamps on what it seeded. Nobody outside this service calls
      // it that, so the screen translates it to the word a person would use and leaves the wire
      // alone. `ui/source.ts` owns both words because the resolved view must say them identically.
      const source = entry.entryClass === 'imported' ? 'imported' : 'operator';
      return {
        entry,
        type: key?.type ?? '',
        typeTone: typeTone(key?.type ?? ''),
        systemOnly: isSystemOnly(key?.type),
        address: key ? declaredDetail(key) : '',
        classLabel: sourceLabel(source),
        classTone: sourceTone(source),
      };
    });
  });

  protected readonly caption = computed(() => plural(this.entries().length, 'entry', 'entries'));

  protected readonly heading = computed(() => {
    const env = this.env();
    return env.length > 0 ? `${this.application()} — ${env}` : this.application();
  });

  /** What an application with no stored rows in this tier says, which is never blank space. */
  protected readonly emptyMessage = computed(
    () =>
      `This application has no entries in ${this.env()}. It will deploy with its declared defaults ` +
      `and whatever its image and the deployer's own defaults give it.`,
  );

  /**
   * What an empty env directory says. The env-less spelling and the addressed one need different
   * sentences: one has nothing to settle on, the other names a tier the listing does not know, and
   * telling a reader "configured in no environment" while a table of its entries is on screen would
   * be the page contradicting itself.
   */
  protected readonly envsEmptyMessage = computed(() => {
    const routeEnv = this.routeEnv();
    return routeEnv.length > 0
      ? `The listing knows no environments for this application, so ${routeEnv} is read as the address gave it.`
      : 'This application is configured in no environment yet.';
  });

  constructor() {
    // Three reads keyed on what each of them actually depends on, which is what keeps a hop between
    // tiers from re-reading the two that did not change. The application is a path segment, so
    // moving between two applications REUSES this component rather than rebuilding it; reading the
    // segments as signals is what makes such a navigation a fetch.
    effect(() => {
      const application = this.application();
      if (application.length > 0) {
        this.loadEnvs();
      }
    });

    effect(() => {
      const application = this.application();
      const env = this.env();
      if (application.length > 0 && env.length > 0) {
        this.loadEntries();
      }
    });

    // The declaration governs the APPLICATION, not one of its tiers, so this does not re-run when
    // the env changes.
    effect(() => {
      const application = this.application();
      if (application.length > 0) {
        this.loadDeclaration();
      }
    });

    // The picker follows the settled env, and the reader's own clear is what it does not follow.
    effect(() => {
      const env = this.env();
      this.picked.set(env.length > 0 ? env : undefined);
    });
  }

  /** The env directory, re-issued by the picker panel's retry. */
  protected loadEnvs(): void {
    const application = this.application();
    this.envsState.set(LOADING);
    // An env-less page cannot know WHICH tier its table is of until this answers, so the table goes
    // back to loading with it. Leaving the previous application's rows on screen while the directory
    // decides would be a table labelled with one name and holding another's entries.
    if (this.routeEnv().length === 0) {
      this.state.set(LOADING);
    }
    this.api.envsOf(application).then(
      (envs) => this.envsState.set(ready(envs)),
      (error: unknown) => {
        this.envsState.set(failed(error));
        // An ADDRESSED page does not need this read to draw its table, and must not lose it to a
        // directory that failed. An env-LESS one has nothing to read entries for, so the failure is
        // the table's too — otherwise the panel would wait for an answer that is never coming.
        if (this.routeEnv().length === 0) {
          this.state.set(failed(error));
        }
      },
    );
  }

  /** The table's own request, re-issued by its retry button. */
  protected loadEntries(): void {
    const application = this.application();
    const env = this.env();
    if (application.length === 0 || env.length === 0) {
      return;
    }
    this.state.set(LOADING);
    this.api.entries(application, env).then(
      (entries) => this.state.set(ready(entries)),
      (error: unknown) => this.state.set(failed(error)),
    );
  }

  /**
   * The governing declaration, in two hops because the wire has no route for "the governing one".
   *
   * The listing is what says which version governs — the intake log decides it and version ordering
   * has no opinion — so the document can only be asked for once that answer is in hand.
   */
  protected loadDeclaration(): void {
    const application = this.application();
    if (application.length === 0) {
      return;
    }
    this.declarationState.set(LOADING);
    this.api.declarations(application).then(
      (declarations) => {
        const governing = declarations.find((summary) => summary.governing);
        if (!governing) {
          this.declarationState.set(ready(null));
          return;
        }
        this.api.declaration(application, governing.version).then(
          (declaration) => this.declarationState.set(ready(declaration)),
          (error: unknown) => this.declarationState.set(failed(error)),
        );
      },
      (error: unknown) => this.declarationState.set(failed(error)),
    );
  }

  /**
   * A tier was picked. This navigates and writes nothing.
   *
   * It PUSHES rather than replaces: the reader took this step deliberately and Back should return
   * them to the tier they came from. Picking from the env-less spelling navigates too — the page had
   * settled that tier already, so the screen does not change, but the address becomes one that can
   * be bookmarked and sent, which is exactly what the reader asked for by touching the control.
   *
   * `undefined` is the picker's cleared state — its own way of putting the list of tiers back — and
   * is not a navigation.
   */
  protected onPick(env: string | undefined): void {
    this.picked.set(env);
    if (!env || env === this.routeEnv()) {
      return;
    }
    void this.router.navigate(this.links.commands('applications', this.application(), 'envs', env));
  }
}
