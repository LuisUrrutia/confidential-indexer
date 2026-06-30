import type {
  Address,
  BatchDecryptTransferAmountResult,
  BatchDecryptTransferAmountsInput,
  DecryptAmountResult,
  DecryptTransferAmountInput,
  EventCursor,
  Hex,
  IndexedEvent,
  IndexedEventBatch,
  RefreshBalanceInput,
  RefreshBalanceResult,
} from "./domain.js";
import type { DecryptionProvider, IndexedEventSource } from "./interfaces.js";

export class FakeIndexedEventSource implements IndexedEventSource {
  readonly #events: IndexedEvent[];

  constructor(events: IndexedEvent[]) {
    this.#events = events;
  }

  async nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch> {
    const events = cursor
      ? this.#events.filter(
          (event) =>
            event.blockNumber > cursor.blockNumber ||
            (event.blockNumber === cursor.blockNumber && event.logIndex > cursor.logIndex),
        )
      : this.#events;
    const last = events.at(-1);
    return {
      events,
      nextCursor: last ? { blockNumber: last.blockNumber, logIndex: last.logIndex } : cursor,
    };
  }
}

export class FakeDecryptionProvider implements DecryptionProvider {
  readonly #amounts = new Map<Hex, bigint>();
  readonly #balances = new Map<string, bigint>();
  #failure: DecryptAmountResult | null = null;

  setAmount(encryptedAmount: Hex, amount: bigint): void {
    this.#amounts.set(encryptedAmount, amount);
  }

  setBalance(input: {
    chainId: number;
    tokenAddress: Address;
    holder: Address;
    balance: bigint;
  }): void {
    this.#balances.set(
      this.#balanceKey(input.chainId, input.tokenAddress, input.holder),
      input.balance,
    );
  }

  failWith(result: Exclude<DecryptAmountResult, { status: "decrypted" }>): void {
    this.#failure = result;
  }

  async decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult> {
    if (this.#failure) return this.#failure;
    const amount = this.#amounts.get(input.encryptedAmount);
    if (amount === undefined) return { status: "not_delegated", reason: "missing_delegation" };
    return { status: "decrypted", amount };
  }

  async batchDecryptTransferAmounts(
    input: BatchDecryptTransferAmountsInput,
  ): Promise<BatchDecryptTransferAmountResult[]> {
    return Promise.all(
      input.encryptedAmounts.map(async (encryptedAmount) => ({
        encryptedAmount,
        result: await this.decryptTransferAmount({ ...input, encryptedAmount }),
      })),
    );
  }

  async refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult> {
    const balance = this.#balances.get(
      this.#balanceKey(input.chainId, input.tokenAddress, input.holder),
    );
    if (balance === undefined) return { status: "unknown", reason: "missing_delegation" };
    return { status: "known", balance, source: "direct_decrypt" };
  }

  #balanceKey(chainId: number, tokenAddress: Address, holder: Address): string {
    return `${chainId}:${tokenAddress.toLowerCase()}:${holder.toLowerCase()}`;
  }
}
