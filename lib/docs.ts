export const docsMarkdown = `# Rupi Mainnet documentation

Rupi is a Mainnet payment workflow for verified Indian individuals and remote workers.

## Supported release scope

- USD-denominated invoices paid in Stellar Mainnet USDC
- Fireblocks-managed Stellar custody mappings; Rupi does not retain a customer seed phrase
- Email OTP authentication, mandatory passkey enrollment, and passkey step-up for fund movement
- Onramp-hosted KYC, tokenized beneficiary setup, signed INR quotes, and verified payout statuses

## Network

- Network: Stellar Mainnet
- Horizon: configured by the deployment
- Asset: USDC classic asset, issuer configured by the deployment and shown on each payment link

## Invoice lifecycle

Rupi creates an expiring payment link with a unique 128-bit public slug and a unique Stellar memo. A scheduled worker advances a durable Horizon cursor for each wallet and validates operation ID, destination, issuer, amount, memo, transaction success, and ledger time. Public payment reads are side-effect-free.

## Cash-out lifecycle

Cash-out is available only to eligible verified users during staged rollout. The user receives a provider quote, reviews all fees including Rupi's disclosed 0.5% fee, completes a passkey step-up bound to amount and idempotency key, then Rupi creates an immutable Onramp order before asking Fireblocks to send the exact USDC amount and memo. A cash-out is marked PAID only after verified Onramp provider status.

## Not in this release

Yield, Blend integration, arbitrary withdrawals, business onboarding, international users, and non-INR settlement are not available in the initial Mainnet release.
`;
