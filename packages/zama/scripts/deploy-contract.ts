import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface FoundryArtifact {
  abi: unknown[];
  bytecode: { object: Hex };
}

const envFile = process.env.LIVE_ENV_FILE ?? ".env.live";
const shouldUpdateEnv = process.argv.includes("--update-env");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Export it or source ${envFile}.`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function setEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, "m");
  if (expression.test(content)) return content.replace(expression, line);
  return `${content.replace(/\n?$/, "\n")}${line}\n`;
}

async function updateEnvFile(address: Address, startBlock: bigint, chainId: number): Promise<void> {
  let content = await readFile(envFile, "utf8");
  const indexerPrivateKeyEnv = `INDEXER_SIGNER_PRIVATE_KEY_${chainId}`;
  const network: Record<string, unknown> = {
    chainId,
    name: optionalEnv("NETWORK_NAME") ?? `chain-${chainId}`,
    rpcUrl: requireEnv("RPC_URL"),
    relayerApiKeyEnv: "RELAYER_API_KEY",
    indexerSignerPrivateKeyEnv: indexerPrivateKeyEnv,
    tokens: [{ address, startBlock: Number(startBlock) }],
  };
  const relayerUrl = optionalEnv("RELAYER_URL");
  if (relayerUrl) network.relayerUrl = relayerUrl;

  content = setEnv(content, "TOKEN_ADDRESS", address);
  content = setEnv(content, "START_BLOCK", startBlock.toString());
  content = setEnv(content, "NETWORKS_JSON", JSON.stringify([network]));
  await writeFile(envFile, content, { mode: 0o600 });
}

const rpcUrl = requireEnv("RPC_URL");
const account = privateKeyToAccount(requireEnv("OWNER_PRIVATE_KEY") as Hex);
const initialSupply = BigInt(process.env.INITIAL_SUPPLY ?? "1000");
const artifact = JSON.parse(
  await readFile("out/ConfidentialTestToken.sol/ConfidentialTestToken.json", "utf8"),
) as FoundryArtifact;
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const chainId = await publicClient.getChainId();
const chain = defineChain({
  id: chainId,
  name: optionalEnv("NETWORK_NAME") ?? `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [account.address, initialSupply],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress)
  throw new Error("Deployment receipt did not include a contract address.");

if (shouldUpdateEnv) await updateEnvFile(receipt.contractAddress, receipt.blockNumber, chainId);

console.log(
  JSON.stringify(
    {
      chainId,
      contractAddress: receipt.contractAddress,
      deploymentBlock: receipt.blockNumber.toString(),
      transactionHash: receipt.transactionHash,
      envUpdated: shouldUpdateEnv ? envFile : false,
    },
    null,
    2,
  ),
);
