/**
 * The wire, written down. Every type here is the shape qits-configuration sends on
 * `/configuration/api`, and nothing here is this application's own idea. This app only reads, so
 * only the read shapes are here.
 *
 * **`entryClass`, not `class`.** The column is `class` and the service says why it cannot spell it
 * that way on the wire — a Java record component cannot be named after a keyword. The name travels
 * as it is rather than being renamed here, so a field in a browser's network tab and a field in this
 * file are the same string.
 *
 * **`defaultValue`, not `default`, for the same class of reason** — the service spells it that way
 * because `default` is a Java keyword too, and renaming it here would make the browser's network tab
 * and this file disagree about one document's most-read field.
 *
 * **A revision's `value` is null exactly when `deleted` is true.** An entry may hold the empty
 * string, so a null value alone could not tell a deletion from a blanking — which is why the flag
 * exists and why nothing here reads the null as "removed" on its own.
 *
 * **The env is on the wire even where the caller named it in the path.** An entry or a revision read
 * out of one response and drawn into a table beside another env's is only identifiable with it, and
 * the cross-env pages here do exactly that. A shape that dropped it would be a shape whose meaning
 * depended on which request produced it.
 */

/** One application's configuration in ONE environment: what it holds there, and how far it has run. */
export interface ApplicationEnvSummary {
  readonly env: string;
  readonly entries: number;
  readonly headRevision: number;
}

/**
 * One application in the listing, across every environment this store holds it in.
 *
 * The counts hang off the envs and not off the application: a single number over every tier is one
 * nobody can act on — "qits-gateway has 11 entries" says nothing about whether prod is missing the
 * one dev has. `envs` is sorted by env name and is never empty.
 */
export interface ApplicationSummary {
  readonly application: string;
  readonly envs: readonly ApplicationEnvSummary[];
}

/**
 * One current entry, as the API hands it back.
 *
 * `orphaned` is computed at read time and stored nowhere: it is true when the application's
 * governing declaration does not account for the key, or declares it a `serviceAddress` whose stored
 * row is ignored in favour of the rendered address. Both mean the same thing to a person — this row
 * is not reaching the container — and neither is an error.
 */
export interface ConfigurationEntry {
  readonly env: string;
  readonly application: string;
  readonly key: string;
  readonly value: string;
  readonly entryClass: string;
  readonly orphaned: boolean;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

/** One recorded write, from the append-only log. */
export interface ConfigurationRevision {
  readonly seq: number;
  readonly env: string;
  readonly application: string;
  readonly key: string;
  readonly value: string | null;
  readonly deleted: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

/**
 * One declaration in a listing: what it is and when it arrived, without the document itself.
 *
 * `governing` is the field the listing exists for. An application accumulates versions and only one
 * of them is what it is currently judged against — decided by the intake log rather than by version
 * ordering, which the service deliberately has no opinion about.
 */
export interface DeclarationSummary {
  readonly application: string;
  readonly version: string;
  readonly deploymentTarget: string;
  readonly contentHash: string;
  readonly keys: number;
  readonly governing: boolean;
  readonly receivedAt: string;
  readonly receivedBy: string | null;
}

/**
 * One declared key, flat, with the fields its own type does not use left null.
 *
 * The nulls are the shape rather than an omission: `type` is the tag and the columns beside it say
 * which fields are populated. `defaultValue` belongs to `string`, `boolean` and `number`; `service`
 * and `port` to `serviceAddress`; `packageType` and `packageName` to `packageVersion`.
 *
 * **There is no rendered address here and no `description`.** A serviceAddress carries the service
 * and the port, never the host they resolve to — that depends on which environment is asking and on
 * which plane the named application deploys onto, so it exists only in a resolved read for one
 * environment. `description` is validated by the service and given no field of its own; it lives in
 * `raw`, which is why the declaration view draws the document beside the parsed keys.
 */
export interface DeclaredKey {
  readonly key: string;
  readonly type: string;
  readonly defaultValue: string | null;
  readonly service: string | null;
  readonly port: number | null;
  readonly packageType: string | null;
  readonly packageName: string | null;
}

/** One declaration in full: what the service parsed out of the document, AND the document. */
export interface Declaration {
  readonly application: string;
  readonly version: string;
  readonly deploymentTarget: string;
  readonly contentHash: string;
  readonly governing: boolean;
  readonly receivedAt: string;
  readonly receivedBy: string | null;
  readonly keys: readonly DeclaredKey[];
  readonly raw: string;
}

/**
 * The deployer-facing read: one application's whole configuration in one environment, at the
 * property NAMES a consumer layers verbatim.
 *
 * **It is flat, and its flatness is the reason the resolved page derives rather than reads.** There
 * is no per-key metadata on this wire — no type, no "this came from a default" — because the
 * consumer is a configuration source and not a screen. Where a key's value came from is worked out
 * on the client, against the entries and the declaration, and `ui/source.ts` is the one place that
 * happens.
 */
export interface ResolvedConfiguration {
  readonly headRevision: number;
  readonly properties: Readonly<Record<string, string>>;
}

/** `GET /configuration/api/applications` */
export interface ListApplicationsResponse {
  readonly applications: readonly ApplicationSummary[];
}

/** `GET /configuration/api/applications/{app}/envs/{env}/entries` */
export interface ListEntriesResponse {
  readonly entries: readonly ConfigurationEntry[];
}

/** `GET …/envs/{env}/history` — newest first, deletions included. */
export interface ListHistoryResponse {
  readonly revisions: readonly ConfigurationRevision[];
}

/** `GET /configuration/api/applications/{app}/declarations` — newest intake first. */
export interface ListDeclarationsResponse {
  readonly declarations: readonly DeclarationSummary[];
}
