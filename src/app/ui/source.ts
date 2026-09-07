import type { QitsBadgeTone } from '@qits/ui-components';
import type { ConfigurationEntry, DeclaredKey } from '../api/dto';

/**
 * Where one resolved value came from — **worked out here, because the wire does not say.**
 *
 * The resolved read is the deployer's, and the deployer is a configuration source rather than a
 * screen: it receives a flat map of names and values with no per-key metadata, and that flatness is
 * the right shape for it. A person reading the same map needs the other half — a default and an
 * override are the same string in that map and the most different things on the page — so the answer
 * is derived on the client from the two reads that do carry it: the entries of that env, and the
 * declaration being resolved against.
 *
 * **The order below is the SERVICE's own precedence, restated.** It is not this module's preference,
 * and getting it backwards would be a screen that disagrees with the deployment it describes:
 *
 * 1. A `serviceAddress` is rendered by the platform and is NOT overridable. A stored row on such a
 *    key is ignored for the value and reported orphaned by the entries read, so the row loses here
 *    too — which is the whole reason this test comes first.
 * 2. A stored entry beats a declared default, and whether it was a person or the bootstrap that
 *    stored it is `entryClass`, ordered at the write rather than here.
 * 3. A declared default is what is left.
 *
 * **`unexplained` is the fourth answer and it is not a fifth kind of source.** It says the resolved
 * map holds a key that neither the entries nor the declaration accounts for — which cannot happen
 * within one instant of the store, so it means the reads this page made did not come from one. It is
 * drawn as an alarm rather than hidden, because a row a reader cannot account for is exactly the row
 * they are about to make a decision on.
 */
export type ValueSource = 'operator' | 'imported' | 'rendered' | 'default' | 'unexplained';

/** The word each source is drawn as. Short enough for a badge, long enough to be unambiguous. */
const LABELS: Readonly<Record<ValueSource, string>> = {
  operator: 'operator',
  imported: 'imported',
  rendered: 'rendered address',
  default: 'default',
  unexplained: 'unexplained',
};

/**
 * The tone each source is drawn in, and the scale is **how much of a human decision the value is**
 * rather than how good it is.
 *
 * A default is nobody's decision and is quiet. The platform rendering an address and a bootstrap
 * file importing a value are decisions taken elsewhere, and both are drawn as information. An
 * operator's own override is the only row on the page a person typed, and it is the row a reader
 * scanning for "why is this tier different" is looking for. `unexplained` is the only alarm, and it
 * is an alarm about the reads rather than about the value.
 */
const TONES: Readonly<Record<ValueSource, QitsBadgeTone>> = {
  operator: 'success',
  imported: 'info',
  rendered: 'info',
  default: 'neutral',
  unexplained: 'danger',
};

/** What the badge says. */
export function sourceLabel(source: ValueSource): string {
  return LABELS[source];
}

/** What tone the badge takes — see the note on {@link TONES}. */
export function sourceTone(source: ValueSource): QitsBadgeTone {
  return TONES[source];
}

/**
 * Which of the four a value in the resolved map came from.
 *
 * `entry` is the stored row for that (env, key) if there is one; `declared` is the key as the
 * declaration being resolved against spells it, if it spells it at all. Both being absent is the
 * `unexplained` case.
 *
 * A `packageVersion` contributes nothing without an entry — the service has no default for one by
 * design — so a declared packageVersion with a stored row resolves as that row's class, and one
 * without never reaches this function because it is not in the map.
 */
export function sourceOf(
  entry: ConfigurationEntry | undefined,
  declared: DeclaredKey | undefined,
): ValueSource {
  if (declared?.type === 'serviceAddress') {
    return 'rendered';
  }
  if (entry) {
    return entry.entryClass === 'imported' ? 'imported' : 'operator';
  }
  if (declared && declared.defaultValue !== null && declared.defaultValue !== undefined) {
    return 'default';
  }
  return 'unexplained';
}

/**
 * What a declared key's type says about itself in one phrase, for the row that draws it.
 *
 * Only the two platform-owned types have anything to add: a `serviceAddress` names the service and
 * port it renders from, and a `packageVersion` names the package whose release fills it in. The
 * three ordinary types are their own explanation.
 */
export function declaredDetail(declared: DeclaredKey): string {
  if (declared.type === 'serviceAddress') {
    return `${declared.service ?? '?'}:${declared.port ?? '?'}`;
  }
  if (declared.type === 'packageVersion') {
    return [declared.packageType, declared.packageName].filter(Boolean).join(' ');
  }
  return '';
}

/**
 * The tone a declared TYPE is drawn in on a key list.
 *
 * `serviceAddress` is the one type a person may not set, so it is the one type whose badge has to
 * stand out from the ordinary three; `packageVersion` is set by a release rather than by hand and
 * sits between the two.
 */
export function typeTone(type: string): QitsBadgeTone {
  if (type === 'serviceAddress') {
    return 'warning';
  }
  return type === 'packageVersion' ? 'info' : 'neutral';
}

/** Whether this type is one the platform fills in and an operator may not set by hand. */
export function isSystemOnly(type: string | undefined): boolean {
  return type === 'serviceAddress';
}
