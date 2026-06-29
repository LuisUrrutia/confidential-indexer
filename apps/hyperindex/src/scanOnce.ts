import { ACL_TOPICS, decodeAclEvent, decodeConfidentialTransfer } from "@zama-fhe/sdk";
import { hardhat, hoodi, mainnet, sepolia, type FheChain } from "@zama-fhe/sdk/chains";
import pg from "pg";
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { toDate, toExpirationDate } from "./time.js";

interface TokenConfig {
  address: Address;
  startBlock: number | string | bigint;
}

interface NetworkConfig {
  chainId: number;
  name?: string;
  rpcUrl: string;
  tokens: TokenConfig[];
}

interface IndexedCounters {
  transfers: number;
  delegations: number;
}

interface DecodableLog {
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
}

const fheChainPresets = new Map<number, FheChain>([
  [hardhat.id, hardhat],
  [sepolia.id, sepolia],
  [hoodi.id, hoodi],
  [mainnet.id, mainnet],
]);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Export it or source .env.live.`);
  return value;
}

function readNetworks(): NetworkConfig[] {
  const networks = JSON.parse(process.env.NETWORKS_JSON ?? "[]") as NetworkConfig[];
  const fallbackToken = process.env.TOKEN_ADDRESS;
  if (networks.length > 0) {
    return networks.map((network) => ({
      ...network,
      tokens:
        network.tokens.length > 0 || !fallbackToken
          ? network.tokens
          : [{ address: fallbackToken as Address, startBlock: process.env.START_BLOCK ?? 0 }],
    }));
  }
  const fallbackNetwork: NetworkConfig = {
    chainId: Number(requireEnv("CHAIN_ID")),
    rpcUrl: requireEnv("RPC_URL"),
    tokens: [
      { address: requireEnv("TOKEN_ADDRESS") as Address, startBlock: process.env.START_BLOCK ?? 0 },
    ],
  };
  if (process.env.NETWORK_NAME) fallbackNetwork.name = process.env.NETWORK_NAME;
  return [fallbackNetwork];
}

function isTokenAddress(tokens: Map<string, Address>, address: Address): Address | null {
  return tokens.get(address.toLowerCase()) ?? null;
}

async function ensureHyperindexTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    create table if not exists hyperindex_events (
      kind text not null,
      chain_id integer not null,
      token_address text not null,
      tx_hash text not null,
      log_index integer not null,
      block_number numeric not null,
      block_timestamp timestamptz not null,
      from_address text,
      to_address text,
      encrypted_amount text,
      delegator text,
      delegate text,
      expires_at timestamptz,
      primary key (chain_id, tx_hash, log_index)
    )
  `);
  await pool.query(
    "create index if not exists hyperindex_events_order on hyperindex_events (block_number asc, log_index asc)",
  );
}

async function blockTimestamp(
  client: PublicClient,
  cache: Map<string, Date>,
  blockNumber: bigint,
): Promise<Date> {
  const key = blockNumber.toString();
  const cached = cache.get(key);
  if (cached) return cached;
  const block = await client.getBlock({ blockNumber });
  const timestamp = toDate(block.timestamp);
  cache.set(key, timestamp);
  return timestamp;
}

function asDecodableLog(log: unknown): DecodableLog | null {
  const candidate = log as Partial<DecodableLog>;
  if (!candidate.blockNumber || candidate.logIndex === undefined || !candidate.transactionHash)
    return null;
  if (!candidate.topics || candidate.topics.length === 0) return null;
  return candidate as DecodableLog;
}

async function insertTransfer(
  pool: pg.Pool,
  network: NetworkConfig,
  log: DecodableLog,
  blockTime: Date,
): Promise<boolean> {
  const decoded = decodeConfidentialTransfer(log);
  if (!decoded) return false;
  const result = await pool.query(
    `insert into hyperindex_events
       (kind, chain_id, token_address, tx_hash, log_index, block_number, block_timestamp, from_address, to_address, encrypted_amount)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict do nothing`,
    [
      "confidential_transfer",
      network.chainId,
      log.address,
      log.transactionHash,
      log.logIndex,
      log.blockNumber.toString(),
      blockTime,
      decoded.from,
      decoded.to,
      decoded.encryptedAmount,
    ],
  );
  return result.rowCount === 1;
}

async function insertDelegation(
  pool: pg.Pool,
  network: NetworkConfig,
  log: DecodableLog,
  blockTime: Date,
  tokenAddress: Address,
): Promise<boolean> {
  const decoded = decodeAclEvent(log);
  if (!decoded) return false;

  const params =
    decoded.eventName === "DelegatedForUserDecryption"
      ? [
          "delegation_granted",
          network.chainId,
          tokenAddress,
          log.transactionHash,
          log.logIndex,
          log.blockNumber.toString(),
          blockTime,
          decoded.delegator,
          decoded.delegate,
          toExpirationDate(decoded.newExpirationDate),
        ]
      : [
          "delegation_revoked",
          network.chainId,
          tokenAddress,
          log.transactionHash,
          log.logIndex,
          log.blockNumber.toString(),
          blockTime,
          decoded.delegator,
          decoded.delegate,
          null,
        ];

  const result = await pool.query(
    `insert into hyperindex_events
       (kind, chain_id, token_address, tx_hash, log_index, block_number, block_timestamp, delegator, delegate, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict do nothing`,
    params,
  );
  return result.rowCount === 1;
}

async function scanNetwork(pool: pg.Pool, network: NetworkConfig): Promise<IndexedCounters> {
  const chain = defineChain({
    id: network.chainId,
    name: network.name ?? `chain-${network.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const latestBlock = process.env.SCAN_TO_BLOCK
    ? BigInt(process.env.SCAN_TO_BLOCK)
    : await client.getBlockNumber();
  const blockStep = BigInt(process.env.SCAN_BLOCK_STEP ?? "5000");
  const timestamps = new Map<string, Date>();
  const counters: IndexedCounters = { transfers: 0, delegations: 0 };
  const tokenAddresses = new Map(
    network.tokens.map((token) => [token.address.toLowerCase(), token.address]),
  );

  for (const token of network.tokens) {
    const fromStart = BigInt(token.startBlock);
    for (let fromBlock = fromStart; fromBlock <= latestBlock; fromBlock += blockStep) {
      const toBlock =
        fromBlock + blockStep - 1n > latestBlock ? latestBlock : fromBlock + blockStep - 1n;
      const logs = await client.getLogs({ address: token.address, fromBlock, toBlock });
      for (const rawLog of logs) {
        const log = asDecodableLog(rawLog);
        if (!log) continue;
        const timestamp = await blockTimestamp(client, timestamps, log.blockNumber);
        if (await insertTransfer(pool, network, log, timestamp)) counters.transfers += 1;
      }
    }
  }

  const aclAddress = fheChainPresets.get(network.chainId)?.aclContractAddress;
  if (!aclAddress || tokenAddresses.size === 0) return counters;
  const earliestStart = network.tokens.reduce((earliest, token) => {
    const start = BigInt(token.startBlock);
    return start < earliest ? start : earliest;
  }, latestBlock);

  for (let fromBlock = earliestStart; fromBlock <= latestBlock; fromBlock += blockStep) {
    const toBlock =
      fromBlock + blockStep - 1n > latestBlock ? latestBlock : fromBlock + blockStep - 1n;
    const logs = await client.getLogs({ address: aclAddress, fromBlock, toBlock });
    for (const rawLog of logs) {
      const log = asDecodableLog(rawLog);
      if (!log || !ACL_TOPICS.includes(log.topics[0])) continue;
      const decoded = decodeAclEvent(log);
      if (!decoded) continue;
      const tokenAddress = isTokenAddress(tokenAddresses, decoded.contractAddress);
      if (!tokenAddress) continue;
      const timestamp = await blockTimestamp(client, timestamps, log.blockNumber);
      if (await insertDelegation(pool, network, log, timestamp, tokenAddress))
        counters.delegations += 1;
    }
  }

  return counters;
}

const pool = new pg.Pool({ connectionString: requireEnv("HYPERINDEX_DATABASE_URL") });
try {
  await ensureHyperindexTable(pool);
  const totals: IndexedCounters = { transfers: 0, delegations: 0 };
  for (const network of readNetworks()) {
    const counts = await scanNetwork(pool, network);
    totals.transfers += counts.transfers;
    totals.delegations += counts.delegations;
  }
  console.log(JSON.stringify(totals, null, 2));
} finally {
  await pool.end();
}
