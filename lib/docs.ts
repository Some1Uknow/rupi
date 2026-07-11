export const testnetContracts = {
  blendPool: {
    label: "Blend Pool V2",
    value: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
    detail: "Soroban pool contract used for Rupi Yield deposits and withdrawals.",
  },
  usdcToken: {
    label: "Blend Testnet USDC token",
    value: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
    detail: "Soroban token contract for the Testnet USDC reserve used by Blend.",
  },
  usdcIssuer: {
    label: "Blend Testnet USDC issuer",
    value: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
    detail: "Classic Stellar asset issuer. This is an account address, not a smart contract.",
  },
} as const;

export const formContractAddresses = [testnetContracts.blendPool.value, testnetContracts.usdcToken.value] as const;

export const docsMarkdown = `# Rupi documentation

Rupi is a Stellar Testnet MVP for global freelancers: create a USD invoice, receive Stellar USDC, optionally supply idle USDC to Blend, and start an INR cash-out.

## Network

- Network: Stellar Testnet
- Horizon: https://horizon-testnet.stellar.org
- Soroban RPC: https://soroban-testnet.stellar.org
- Network passphrase: Test SDF Network ; September 2015

## Smart contract addresses (Testnet)

For a form that accepts multiple smart contract addresses, enter these two Soroban contract IDs:

1. Blend Pool V2: ${testnetContracts.blendPool.value}
2. Blend Testnet USDC token: ${testnetContracts.usdcToken.value}

Rupi does not deploy a custom smart contract in this MVP. It uses the Blend Pool V2 contract for Yield and native Stellar payments for invoices. The Testnet USDC classic-asset issuer is ${testnetContracts.usdcIssuer.value}; it is an account address, not a contract.

## Product flows

### Invoices and payments

Rupi creates USD-denominated invoice links. The payer sends the configured Testnet USDC asset to the app-managed Stellar wallet with the invoice memo. Rupi reconciles the payment through Horizon and marks the invoice paid.

### Yield

Users explicitly supply or withdraw Testnet USDC through Blend Pool V2. Rupi records the resulting position and reads the pool reserve state. Yield is variable and Testnet-only.

### Cash out

Rupi sends Testnet USDC to a configured Testnet sink account, then shows INR payout states for the off-ramp flow. The USDC transfer is real on Testnet; INR payout statuses are simulated in this MVP.

## Safety

- Stellar Testnet resets periodically.
- Never use a Testnet key or address on mainnet.
- Rupi wallet secrets are encrypted server-side using AES-256-GCM.
- Mainnet remains disabled unless explicitly configured.
`;
