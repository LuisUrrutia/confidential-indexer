import { DelegationEventKind } from "@confidential-indexer/core";
import type {
  DelegationRepository,
  IndexedEvent,
  StoredTransfer,
} from "@confidential-indexer/core";
import type { PostgresPool } from "./postgres-pool.js";

export class PostgresDelegationRepository implements DelegationRepository {
  constructor(private readonly pool: PostgresPool) {}

  async upsertGrant(
    event: Extract<IndexedEvent, { kind: typeof DelegationEventKind.DelegationGranted }>,
  ): Promise<void> {
    await this.pool.query(
      `insert into delegations (chain_id, token_address, delegator, delegate, active, expires_at, updated_at)
       values ($1,$2,$3,$4,true,$5,now())
       on conflict (chain_id, token_address, delegator, delegate) do update set
       active = true, expires_at = excluded.expires_at, updated_at = now()`,
      [
        event.chainId,
        event.tokenAddress.toLowerCase(),
        event.delegator.toLowerCase(),
        event.delegate.toLowerCase(),
        event.expiresAt,
      ],
    );
  }

  async markRevoked(
    event: Extract<IndexedEvent, { kind: typeof DelegationEventKind.DelegationRevoked }>,
  ): Promise<void> {
    await this.pool.query(
      `insert into delegations (chain_id, token_address, delegator, delegate, active, updated_at)
       values ($1,$2,$3,$4,false,now())
       on conflict (chain_id, token_address, delegator, delegate) do update set active = false, updated_at = now()`,
      [
        event.chainId,
        event.tokenAddress.toLowerCase(),
        event.delegator.toLowerCase(),
        event.delegate.toLowerCase(),
      ],
    );
  }

  async listActiveDelegators(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
  }): Promise<StoredTransfer["to"][]> {
    const result = await this.pool.query(
      `select delegator from delegations
       where chain_id = $1
       and token_address = lower($2)
       and active = true
       and (expires_at is null or expires_at > now())
       order by updated_at desc`,
      [input.chainId, input.tokenAddress],
    );
    return result.rows.map((row) => row.delegator as StoredTransfer["to"]);
  }

  async isActive(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
    delegator: StoredTransfer["to"];
    delegate?: StoredTransfer["to"];
  }): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from delegations
       where chain_id = $1
       and token_address = lower($2)
       and delegator = lower($3)
       and ($4::text is null or delegate = lower($4))
       and active = true
       and (expires_at is null or expires_at > now())
       limit 1`,
      [input.chainId, input.tokenAddress, input.delegator, input.delegate ?? null],
    );
    return result.rowCount === 1;
  }
}
