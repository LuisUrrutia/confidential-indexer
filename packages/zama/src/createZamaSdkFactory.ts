import { memoryStorage, ZamaSDK } from "@zama-fhe/sdk";
import { hardhat, hoodi, mainnet, sepolia, type FheChain } from "@zama-fhe/sdk/chains";
import { node } from "@zama-fhe/sdk/node";
import { createConfig } from "@zama-fhe/sdk/viem";
import { createPublicClient, createWalletClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ZamaSdkFactory, ZamaSdkLike } from "./ZamaDecryptionProvider.js";

export interface ZamaNetworkConfig {
  chainId: number;
  name?: string;
  rpcUrl: string;
  relayerUrl?: string;
  relayerApiKey?: string;
  indexerSignerPrivateKey: `0x${string}`;
}

export interface CreateZamaSdkFactoryOptions {
  networks: ZamaNetworkConfig[];
  workerPoolSize?: number;
}

const fheChainPresets = new Map<number, FheChain>([
  [hardhat.id, hardhat],
  [sepolia.id, sepolia],
  [hoodi.id, hoodi],
  [mainnet.id, mainnet],
]);

function getFheChain(network: ZamaNetworkConfig): FheChain {
  const preset = fheChainPresets.get(network.chainId);
  if (!preset) {
    throw new Error(
      `Unsupported Zama FHE chain ${network.chainId}. Use a Zama-supported preset chain.`,
    );
  }

  const base = {
    ...preset,
    relayerUrl: network.relayerUrl ?? preset.relayerUrl,
    network: network.rpcUrl,
  } satisfies FheChain;

  if (!network.relayerApiKey) return base;
  return {
    ...base,
    auth: { __type: "ApiKeyHeader", value: network.relayerApiKey },
  } satisfies FheChain;
}

function getViemChain(network: ZamaNetworkConfig): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name ?? `chain-${network.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
}

export function createZamaSdkFactory(options: CreateZamaSdkFactoryOptions): ZamaSdkFactory {
  const networks = new Map(options.networks.map((network) => [network.chainId, network]));
  const sdks = new Map<number, ZamaSdkLike>();

  return (chainId: number): ZamaSdkLike => {
    const existing = sdks.get(chainId);
    if (existing) return existing;

    const network = networks.get(chainId);
    if (!network) throw new Error(`No Zama network configured for chain ${chainId}.`);

    const account = privateKeyToAccount(network.indexerSignerPrivateKey);
    const viemChain = getViemChain(network);
    const publicClient = createPublicClient({ chain: viemChain, transport: http(network.rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: viemChain,
      transport: http(network.rpcUrl),
    });
    const fheChain = getFheChain(network);
    const relayer =
      options.workerPoolSize === undefined ? node() : node({ poolSize: options.workerPoolSize });
    const config = createConfig({
      chains: [fheChain],
      publicClient,
      walletClient,
      storage: memoryStorage,
      relayers: {
        [fheChain.id]: relayer,
      },
    });
    const sdk = new ZamaSDK(config) as ZamaSdkLike;
    sdks.set(chainId, sdk);
    return sdk;
  };
}
