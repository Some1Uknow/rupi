# Rupi Mainnet release

Rupi is a Mainnet-only payment workflow for verified Indian individuals and remote workers: USD invoices paid in Stellar USDC, Fireblocks-managed custody, and staged INR settlement through Onramp.

## Deployment order

1. Create a fresh Mainnet PostgreSQL database. Do not import Testnet wallet, beneficiary, order, or demo data.
2. Set every production variable in [.env.example](.env.example), using a secret manager and a verified database CA.
3. Run `npm ci`, then `npm run db:migrate` once for the immutable deployment SHA.
4. Run `npm run onramp:sync` during deployment to verify Stellar USDC, the `xlm` network, memo support, and quote configuration before enabling cash-out.
5. Deploy the clean Git revision and set `RUPI_EXPECTED_RELEASE_SHA` to that revision. `/api/health` rejects a SHA mismatch.
6. Start cash-out at `CASHOUT_ROLLOUT_PERCENTAGE=0`, then advance internal, 10%, 50%, and 100% stages only after the operational acceptance criteria are met.

## Launch gates

The code intentionally fails closed until all of these are real:

- Fireblocks Stellar Mainnet proof-of-capability, approved asset IDs, treasury reserve cap, and policy enforcement.
- Onramp private white-label API entitlement for hosted KYC, tokenized beneficiary setup, quotes, orders, refunds, status polling, and signed webhooks.
- The partner quote-signing contract: every quote must return the documented canonical signed payload and a valid HMAC using `ONRAMP_QUOTE_SIGNING_SECRET`; unsigned or mismatched quotes fail closed.
- Indian legal/compliance approval and an active grievance contact.
- A low-value production invoice and INR-settlement canary reconciled manually.

## Verification

```bash
npm run typecheck
npm test
npm run audit:prod
npm run build
```

`/api/cron/stellar-reconcile` advances durable Horizon cursors. `/api/cron/provider-events` processes signature-verified provider webhooks, polls provider orders as fallback, and refreshes Onramp configuration daily. Both require `Authorization: Bearer $CRON_SECRET`.
