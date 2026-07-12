# Rupi Mainnet technical specification

## Scope

Rupi serves verified Indian individuals and remote workers. The launch release supports USD-denominated invoices paid in Stellar Mainnet USDC and staged INR cash-out through Onramp. Yield, Blend, arbitrary external withdrawals, business onboarding, non-INR settlement, and international accounts are out of scope.

## Trust boundaries

- **Rupi** stores application state, audit records, Fireblocks vault mappings, provider customer IDs, beneficiary tokens, and masked bank details.
- **Fireblocks** creates and signs for the Stellar vault account. Rupi stores no seed phrase, decryptable key, or signing material.
- **Onramp** owns KYC decisions, hosted identity collection, bank-detail capture, quotes, order status, refunds, and INR settlement.
- **Stellar Horizon** is read by the scheduled reconciliation worker only; public payment reads never trigger reconciliation.

## Authentication and authorization

1. A user enters an email and receives a Resend-delivered OTP through Better Auth.
2. OTP verification creates a pending account.
3. A WebAuthn passkey is mandatory before product access.
4. Cash-out and beneficiary changes require a fresh passkey assertion. The server issues a single-use, five-minute token bound to user, action, amount, and idempotency key.
5. Authentication, passkey, custody, provider, and financial events are written to append-only audit records.

## Custody

`stellar_wallets` contains one Mainnet Fireblocks vault mapping per user, its public Stellar address, registered XLM and USDC Fireblocks asset IDs, activation state, and policy state. A capped treasury XLM reserve is sent only from the configured treasury vault. Wallets cannot create invoices or cash-out until Fireblocks policy state is explicitly enforced and the reserve transfer is confirmed.

## Invoice and reconciliation path

- Invoice fields are bounded and line totals are calculated with integer stroop arithmetic.
- Each payment intent receives a 128-bit public slug and unique Stellar memo.
- Expiry is checked by the UI, public API response, scheduled worker, and stored state transition.
- The worker stores one Horizon cursor per wallet, uses an advisory lock, reads bounded pages, and records operations idempotently by operation ID.
- A matching operation must have a successful transaction, Mainnet destination, configured USDC issuer, exact memo, valid ledger time, and valid amount. Partial and overpayments are aggregated transactionally.

## Cash-out path

1. Load a fresh Onramp configuration snapshot and dynamically select `coinCode=usdc` with the network symbol `xlm`; require memo support and limits.
2. Require approved KYC, tokenized beneficiary, active Fireblocks wallet, operator controls, rollout eligibility, per-transaction ₹25,000 cap, and rolling 24-hour ₹50,000 cap.
3. Request and persist an immutable provider quote containing gross INR, Onramp fee, gateway fee, TDS, 0.5% Rupi fee, net INR, provider quote ID, signature, and expiry.
4. Consume a matching passkey step-up token.
5. Create the Onramp order, validate its Stellar address/memo, and persist it before signing.
6. Submit exactly the quoted USDC through Fireblocks and persist the Fireblocks transaction ID before responding.
7. Never retry a `SUBMISSION_UNKNOWN` order. Reconcile Fireblocks by external transaction ID and provider status first.
8. Mark `PAID` only from a verified Onramp order status.

## Operations

- Fireblocks and Onramp webhooks verify raw-body HMAC signatures with timing-safe comparison, require a fresh timestamp, write an idempotent event inbox, and return quickly. A scheduled worker processes retries and polls provider status as fallback.
- `operator_controls` can independently pause signup, invoices, signing, and cash-out.
- Operator endpoints list held/unknown orders, replay provider reconciliation, request refunds, and export redacted audit records.
- Production boot requires database TLS CA verification, auth/email/provider/webhook/rate-limit/asset settings, an approved Fireblocks policy flag, an expected deployment SHA, and migration `001_mainnet_core.sql`.

## Launch gates

No code configuration substitutes for Fireblocks Stellar proof-of-capability, Onramp private partner entitlement, legal/compliance approval, webhook registration, operational drills, or a low-value production settlement canary. Cash-out remains fail-closed until those gates are complete.
