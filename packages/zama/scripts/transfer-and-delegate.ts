import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createZamaSdkFactory } from "../src/zama-sdk-factory.js";

interface LiveToken {
  confidentialTransfer(
    to: `0x${string}`,
    amount: bigint,
    options?: { skipBalanceCheck?: boolean },
  ): Promise<{ hash?: `0x${string}`; transactionHash?: `0x${string}` }>;
}

interface LiveSdk {
  createToken(address: `0x${string}`): LiveToken;
  delegations: {
    delegateDecryption(input: {
      contractAddress: `0x${string}`;
      delegateAddress: `0x${string}`;
    }): Promise<{ hash?: `0x${string}`; transactionHash?: `0x${string}` }>;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Export it or source .env.live.`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function transactionHash(result: {
  hash?: `0x${string}`;
  transactionHash?: `0x${string}`;
}): string | undefined {
  return result.hash ?? result.transactionHash;
}

const chainId = Number(requireEnv("CHAIN_ID"));
const rpcUrl = requireEnv("RPC_URL");
const tokenAddress = requireEnv("TOKEN_ADDRESS") as `0x${string}`;
const ownerPrivateKey = requireEnv("OWNER_PRIVATE_KEY") as Hex;
const owner = privateKeyToAccount(ownerPrivateKey);
const indexerPrivateKey = requireEnv(`INDEXER_SIGNER_PRIVATE_KEY_${chainId}`) as Hex;
const indexer = privateKeyToAccount(indexerPrivateKey);
const relayerApiKey = optionalEnv("RELAYER_API_KEY");
const amount = BigInt(process.env.TRANSFER_AMOUNT ?? "25");

const sdk = createZamaSdkFactory({
  networks: [
    {
      chainId,
      name: optionalEnv("NETWORK_NAME"),
      rpcUrl,
      relayerUrl: optionalEnv("RELAYER_URL"),
      relayerApiKey,
      indexerSignerPrivateKey: ownerPrivateKey,
    },
  ],
})(chainId) as unknown as LiveSdk;

const token = sdk.createToken(tokenAddress);
const transfer = await token.confidentialTransfer(owner.address, amount, {
  skipBalanceCheck: true,
});
const delegation = await sdk.delegations.delegateDecryption({
  contractAddress: tokenAddress,
  delegateAddress: indexer.address,
});

console.log(
  JSON.stringify(
    {
      chainId,
      tokenAddress,
      holder: owner.address,
      delegate: indexer.address,
      transferAmount: amount.toString(),
      transferTx: transactionHash(transfer),
      delegationTx: transactionHash(delegation),
      next: "Wait 1-2 minutes for ACL propagation, then run pnpm live:scan and start the API.",
    },
    null,
    2,
  ),
);
