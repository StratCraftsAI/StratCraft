import { z } from 'zod';

/**
 * TICKET_1335 D2: shared factor catalog identity.
 *
 * This exists because the retired `install_factor_engine` /
 * `uninstall_factor_engine` MCP tools declared `engine_id: z.string()`, and that
 * unconstrained string reached a SQL lookup whose `python_package` column was
 * interpolated verbatim into `execSync('pip install ' + ...)`. The registry row
 * was the only thing standing between model input and a shell command.
 *
 * The package-install path is gone (the locked `pixi.toml` + `pixi.lock`
 * manifest is the sole owner of Python package identity), but the catalog
 * operations that replaced it still take an identifier across a trust boundary.
 * That identifier is constrained here, in the shared contracts package, so the
 * Electron main process and the standalone MCP process narrow against one list
 * rather than two copies that can drift.
 *
 * Deliberately NOT in this module: any mapping from a catalog to a Python
 * package name. `apps/desktop/src/shared/constants/factor-engines.ts` documents
 * why the former `ENGINE_PYTHON_PACKAGES` map was deleted; reintroducing such a
 * map here would recreate the same dual-authority drift one layer higher.
 */

/**
 * Every factor catalog the registry can seed. Mirrors the builtin catalog set
 * in `apps/desktop/src/shared/constants/factor-engines.ts`; the runtime-tuple
 * shape is required so `z.enum()` can consume it directly.
 */
export const FACTOR_CATALOG_IDS = [
  'alpha158',
  'alpha101',
  'talib',
  'alpha191',
  'jkp',
] as const;

export type FactorCatalogId = (typeof FACTOR_CATALOG_IDS)[number];

/**
 * The single validator for catalog identity crossing a process or trust
 * boundary. Adapters narrow with this before any database access.
 */
export function isFactorCatalogId(value: unknown): value is FactorCatalogId {
  return typeof value === 'string'
    && (FACTOR_CATALOG_IDS as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Human-origin attestation for catalog deactivation (TICKET_1335 AC12b)
// -----------------------------------------------------------------------------

/**
 * Evidence that a human approved one catalog deactivation, as it crosses a
 * process boundary.
 *
 * Deactivation is the third local-machine mutation named by D6, alongside
 * environment install and repair, and it is destructive in a way the other two
 * are not: it `DELETE`s every `nona_factors` row sourced from the catalog. Those
 * rows are not re-derivable from the lock -- re-seeding rebuilds the builtin
 * catalog, not any downstream state that referenced the removed factors. So it
 * carries the same authority requirement as install and repair, and for the same
 * reason: the process that performs the mutation must be the one that saw the
 * human.
 *
 * This mirrors `ResearchEnvironmentApprovalAttestation` rather than reusing it,
 * because the two bind different subjects. An environment approval binds the
 * profile and the manifest/lock hashes; there is no manifest here. What a
 * deactivation approval must bind is stated by AC12b: the constrained engine ID
 * and the catalog revision being removed. Reusing the environment attestation
 * would leave both unbound, so an approval for deactivating `talib` would
 * authorize deactivating `jkp`.
 *
 * `catalogRevision` is deliberately absent from this transported shape, for the
 * same reason `ResearchEnvironmentApprovalAttestation` omits the manifest and
 * lock hashes: the process that owns the registry re-reads and re-derives the
 * revision at admission (D4 forbids adapters prevalidating a value and assuming
 * the owner will see the same state), so transporting one would add a field that
 * is either ignored or -- worse -- trusted, letting a caller pin an approval to a
 * catalog state the database no longer has. The revision is bound in the
 * internal approval, which never crosses a process boundary.
 */
export interface FactorCatalogDeactivationAttestation {
  /** The mutation the human approved. Present so a future catalog mutation cannot reuse this shape. */
  operation: 'deactivate';
  /** The catalog the decision was bound to. */
  engineId: FactorCatalogId;
  /** Opaque identity of the surface the decision was granted to. */
  grantedTo: string;
  /** Identity of the decision itself; enforces single-use at the owner. */
  decisionId: string;
  /** When the authority verified the human decision. */
  verifiedAt: string;
}

export const factorCatalogDeactivationAttestationSchema:
z.ZodType<FactorCatalogDeactivationAttestation> = z.object({
  operation: z.literal('deactivate'),
  engineId: z.enum(FACTOR_CATALOG_IDS),
  grantedTo: z.string().min(1),
  decisionId: z.string().min(1),
  verifiedAt: z.string().datetime(),
  // `.strict()` is the enforcement, not decoration: without it zod strips
  // unknown keys, so a smuggled `confirm: true` or a transported approval
  // object would be silently dropped rather than refused (D6 item 3).
}).strict();

export function parseFactorCatalogDeactivationAttestation(
  value: unknown,
): FactorCatalogDeactivationAttestation {
  return factorCatalogDeactivationAttestationSchema.parse(value);
}

/** The registry state that determines which rows a deactivation would delete. */
export interface FactorCatalogRevisionInput {
  engineId: string;
  catalogActive: number;
  factorCount: number;
  activatedAt: string | null;
}

/**
 * Derive the catalog revision that a deactivation approval binds to.
 *
 * Deliberately derived rather than stored in a new column. A revision column
 * would be a second truth about catalog state that every writer must remember to
 * bump; the moment one path forgot, the drift check would pass while describing
 * a stale set of rows -- the exact failure this guard exists to prevent. These
 * four fields are the state that already decides what `DELETE FROM nona_factors
 * WHERE source = ?` removes, so any re-seed or re-activation between the human's
 * decision and admission necessarily changes the derived value.
 *
 * `activatedAt` is included because a deactivate/re-activate cycle can restore
 * an identical `factorCount`; without the timestamp, an approval issued before
 * the cycle would still match afterwards and authorize deleting rows the human
 * never saw.
 *
 * Shared here so Electron Main and the standalone MCP process derive it
 * identically. Two private copies would drift, and a drift in the drift-guard
 * silently disables it.
 */
export function deriveFactorCatalogRevision(
  input: FactorCatalogRevisionInput,
): string {
  return [
    input.engineId,
    input.catalogActive,
    input.factorCount,
    input.activatedAt ?? 'never',
  ].join(':');
}
