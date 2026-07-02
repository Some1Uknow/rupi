# Rupi — Full Technical Specification
### Stellar-native USDC Invoicing + Yield for Indian Freelancers
**Version 1.0 · June 2026 · Stack: Next.js 14 · PostgreSQL · Stellar Mainnet**

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Environment & Dependencies](#2-environment--dependencies)
3. [Database Schema](#3-database-schema)
4. [Authentication & Onboarding](#4-authentication--onboarding)
5. [Stellar Account Management](#5-stellar-account-management)
6. [Invoice System](#6-invoice-system)
7. [Payment Detection (Horizon Event Stream)](#7-payment-detection-horizon-event-stream)
8. [Yield Module (Blend Protocol)](#8-yield-module-blend-protocol)
9. [Cash-Out Flow (USDC → INR)](#9-cash-out-flow-usdc--inr)
10. [Compliance & Documentation](#10-compliance--documentation)
11. [API Route Reference](#11-api-route-reference)
12. [Cron Jobs](#12-cron-jobs)
13. [Frontend Pages & Components](#13-frontend-pages--components)
14. [Environment Variables](#14-environment-variables)
15. [Third-Party SDKs & Contracts Reference](#15-third-party-sdks--contracts-reference)
16. [Security Considerations](#16-security-considerations)
17. [Hackathon Demo Script](#17-hackathon-demo-script)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        RUPI PLATFORM                            │
│                                                                 │
│  Next.js 14 (App Router)                                        │
│  ┌──────────────────┐   ┌──────────────────┐                   │
│  │  Frontend (React) │   │  API Routes       │                  │
│  │  /app/...         │   │  /app/api/...     │                  │
│  └──────────────────┘   └──────────────────┘                   │
│            │                      │                             │
│            ▼                      ▼                             │
│  ┌──────────────────────────────────────────┐                   │
│  │         PostgreSQL (Neon/Supabase)        │                  │
│  │  users · invoices · cashouts              │                  │
│  │  yield_positions · stellar_events         │                  │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
         │                        │                    │
         ▼                        ▼                    ▼
┌─────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│  Stellar Horizon │   │  Soroban RPC    │   │  External APIs   │
│  (Mainnet)       │   │  (Blend pools)  │   │  Resend · PDF    │
│  Event stream    │   │  supply/withdraw│   │  CoinDCX manual  │
└─────────────────┘   └─────────────────┘   └──────────────────┘
```

### Key architectural decisions

| Decision | Choice | Reason |
|---|---|---|
| Wallet model | Custodial (server holds encrypted key) | Fastest for hackathon; user never sees seed phrase |
| INR off-ramp | Manual CoinDCX + instructions | Skydo has no public API; CoinDCX programmatic INR withdrawal not available |
| Yield | Blend Protocol via Soroban RPC | Only live lending protocol on Stellar mainnet |
| Auth | NextAuth.js + email/password | Simple, fast; Freighter connect as optional add-on |
| DB | PostgreSQL (Neon serverless) | Free tier, serverless-friendly, good with Prisma |
| Hosting | Vercel | Native Next.js, cron support, env management |

---

## 2. Environment & Dependencies

### Node packages

```bash
npm install @stellar/stellar-sdk @stellar/freighter-api
npm install next-auth @auth/prisma-adapter
npm install @prisma/client prisma
npm install resend                          # email
npm install puppeteer-core @sparticuz/chromium  # PDF generation on Vercel
npm install crypto-js                      # AES key encryption
npm install zod                            # input validation
npm install date-fns                       # date formatting
npm install nanoid                         # invoice slug generation
```

### Stellar network constants

```typescript
// lib/stellar/constants.ts

export const STELLAR_NETWORK = {
  mainnet: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    sorobanRpcUrl: "https://soroban-rpc.stellar.org",  // or use official SDF
  },
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  }
}

// USDC on Stellar mainnet — Circle's official issuer
export const USDC = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  // This is the Classic Asset form. For Soroban interactions use the SAC address:
  sacAddress: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUD"
}

// Blend Protocol — mainnet deployed contracts
export const BLEND = {
  poolFactory: "CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU",
  backstop:    "CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7",
  // The primary USDC lending pool — verify at mainnet.blend.capital before use
  // This is the "USDC" pool listed on the Blend UI
  usdcPool:    "<verify at docs.blend.capital/mainnet-deployments>",
  blndToken:   "GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY",
}
```

> **Important:** Always verify the Blend USDC pool address at `docs.blend.capital/mainnet-deployments` before deployment. The pool factory allows multiple pools — use only the officially listed USDC supply pool.

### Prisma setup

```bash
npx prisma init --datasource-provider postgresql
```

---

## 3. Database Schema

### Full Prisma schema (`prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                String    @id @default(uuid())
  email             String    @unique
  name              String
  passwordHash      String
  
  // Stellar wallet (custodial)
  stellarPubKey     String    @unique
  stellarSecretEnc  String    // AES-256 encrypted with MASTER_ENCRYPTION_KEY
  
  // Yield preferences
  yieldEnabled      Boolean   @default(false)
  
  // Indian compliance
  pan               String?   // for tax records
  gstNumber         String?   // optional
  bankIfsc          String?
  bankAccount       String?
  bankName          String?
  
  // CoinDCX linking (manual — user provides their CoinDCX USDC deposit address)
  coindcxStellarDepositAddr String?  // their CoinDCX Stellar USDC deposit address
  
  // RBI Purpose Code default
  defaultPurposeCode String   @default("P0802")  // Software Consultancy
  
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  invoices          Invoice[]
  yieldPosition     YieldPosition?
  cashouts          Cashout[]
  stellarEvents     StellarEvent[]
  
  @@map("users")
}

enum InvoiceStatus {
  DRAFT
  SENT
  PAID
  CASHED_OUT
}

model Invoice {
  id                  String        @id @default(uuid())
  userId              String
  user                User          @relation(fields: [userId], references: [id])
  
  invoiceNumber       String        @unique  // INV-2026-001
  clientName          String
  clientEmail         String?
  
  // Amounts
  amountUsd           Decimal       @db.Decimal(12, 2)
  amountReceivedUsdc  Decimal?      @db.Decimal(12, 6)
  
  description         String
  dueDate             DateTime?
  lineItems           Json?         // [{description, qty, rate, total}]
  
  status              InvoiceStatus @default(DRAFT)
  
  // Payment routing
  paySlug             String        @unique  // public URL slug e.g. "inv-abc123"
  stellarMemo         String        @unique  // e.g. "RUPI-001" — matches payments
  
  // Compliance
  purposeCode         String        @default("P0802")
  
  // On-chain proof
  stellarTxHash       String?
  paidAt              DateTime?
  
  // Yield tracking for this invoice's funds
  yieldDepositedAt    DateTime?
  yieldEarnedUsdc     Decimal       @db.Decimal(12, 6) @default(0)
  
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  
  cashout             Cashout?
  
  @@map("invoices")
}

model YieldPosition {
  id              String    @id @default(uuid())
  userId          String    @unique
  user            User      @relation(fields: [userId], references: [id])
  
  blendPoolAddr   String    // Blend USDC pool contract address
  depositedUsdc   Decimal   @db.Decimal(12, 6)  // total principal in pool
  bTokensHeld     Decimal   @db.Decimal(18, 6)  // Blend bToken balance
  earnedUsdc      Decimal   @db.Decimal(12, 6) @default(0)  // cumulative
  currentApy      Decimal   @db.Decimal(5, 4) @default(0)   // e.g. 0.0420 = 4.20%
  
  status          String    @default("active")  // active | withdrawn
  lastSyncedAt    DateTime  @default(now())
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  @@map("yield_positions")
}

enum CashoutStatus {
  INITIATED     // Rupi has built the tx
  USDC_SENT     // USDC sent to CoinDCX on Stellar
  PENDING_INR   // Waiting for user to sell on CoinDCX
  COMPLETE      // User confirmed INR received
  FAILED
}

model Cashout {
  id                  String        @id @default(uuid())
  userId              String
  user                User          @relation(fields: [userId], references: [id])
  
  invoiceId           String?       @unique
  invoice             Invoice?      @relation(fields: [invoiceId], references: [id])
  
  usdcAmount          Decimal       @db.Decimal(12, 6)  // USDC being cashed out
  inrRateSnapshot     Decimal       @db.Decimal(10, 4)  // rate at initiation
  inrEstimate         Decimal       @db.Decimal(14, 2)  // expected INR
  
  // Yield included in this cashout
  yieldIncluded       Decimal       @db.Decimal(12, 6) @default(0)
  
  // On-chain
  stellarTxHash       String?       // USDC send to CoinDCX tx
  destinationAddr     String?       // CoinDCX Stellar deposit address used
  
  // Compliance
  purposeCode         String        @default("P0802")
  tdsAmount           Decimal       @db.Decimal(12, 2) @default(0)  // 1% estimate
  
  status              CashoutStatus @default(INITIATED)
  completedAt         DateTime?
  
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  
  @@map("cashouts")
}

enum StellarEventType {
  PAYMENT_RECEIVED
  YIELD_DEPOSIT
  YIELD_WITHDRAW
  CASHOUT_SEND
}

model StellarEvent {
  id          String            @id @default(uuid())
  userId      String
  user        User              @relation(fields: [userId], references: [id])
  
  txHash      String            @unique  // dedup key — never process same tx twice
  eventType   StellarEventType
  amountUsdc  Decimal           @db.Decimal(12, 6)
  memo        String?
  ledger      BigInt
  
  createdAt   DateTime          @default(now())
  
  @@map("stellar_events")
}
```

---

## 4. Authentication & Onboarding

### 4.1 NextAuth configuration

```typescript
// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })
        if (!user) return null
        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.name }
      }
    })
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" }
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

### 4.2 Registration endpoint

**Route:** `POST /api/auth/register`

**Input:**
```typescript
{
  email: string,       // valid email
  password: string,    // min 8 chars
  name: string,        // display name
  purposeCode?: string // default "P0802"
}
```

**Process:**
1. Validate inputs with Zod
2. Check email not already registered
3. Hash password with `bcrypt.hash(password, 12)`
4. Generate Stellar keypair: `Keypair.random()`
5. Encrypt secret key: `AES.encrypt(keypair.secret(), MASTER_KEY)`
6. Fund account via Stellar's `friendbot` on testnet — on mainnet, send 1.5 XLM from a platform fee account to activate it (min 1 XLM reserve + 0.5 for USDC trustline)
7. Create USDC trustline on the new account (see 5.2)
8. Insert user row
9. Return `{ success: true, stellarPubKey }`

**Output:**
```typescript
{
  success: true,
  stellarPubKey: "GABC...XYZ"
}
```

### 4.3 Onboarding steps (after registration)

Onboarding is a 3-step wizard stored in `localStorage` until complete:

| Step | Fields | Required? |
|------|--------|-----------|
| 1. Profile | Name, business type, GST (optional) | Yes |
| 2. Compliance | PAN, default purpose code | Yes |
| 3. Bank details | IFSC, account number, bank name | Yes (for cash-out) |
| 4. CoinDCX address | Their CoinDCX Stellar USDC deposit address | Optional (needed for cashout) |

Step 4 requires the user to get their Stellar USDC deposit address from CoinDCX:
> CoinDCX → Funds → Deposit → USDC → Select Stellar network → Copy address

This address is stored as `coindcxStellarDepositAddr` on the user row.

---

## 5. Stellar Account Management

### 5.1 Key encryption/decryption

```typescript
// lib/stellar/keystore.ts
import CryptoJS from "crypto-js"

const MASTER_KEY = process.env.STELLAR_ENCRYPTION_KEY! // 32-char random string

export function encryptSecret(secret: string): string {
  return CryptoJS.AES.encrypt(secret, MASTER_KEY).toString()
}

export function decryptSecret(encrypted: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, MASTER_KEY)
  return bytes.toString(CryptoJS.enc.Utf8)
}
```

> **Security note:** `STELLAR_ENCRYPTION_KEY` must never be logged or exposed. Rotate it if compromised — you'll need to re-encrypt all stored secrets. For production beyond hackathon, use AWS KMS or Vault.

### 5.2 Create USDC trustline

Called once during registration on the new user's account:

```typescript
// lib/stellar/trustline.ts
import { Keypair, Networks, TransactionBuilder, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk"
import { server } from "./horizon"
import { USDC, STELLAR_NETWORK } from "./constants"

export async function createUsdcTrustline(userSecret: string) {
  const keypair = Keypair.fromSecret(userSecret)
  const account = await server.loadAccount(keypair.publicKey())
  const usdcAsset = new Asset(USDC.code, USDC.issuer)

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK.mainnet.networkPassphrase
  })
    .addOperation(Operation.changeTrust({ asset: usdcAsset }))
    .setTimeout(30)
    .build()

  tx.sign(keypair)
  return server.submitTransaction(tx)
}
```

### 5.3 Read USDC balance

```typescript
// lib/stellar/balance.ts
export async function getUsdcBalance(publicKey: string): Promise<string> {
  const account = await server.loadAccount(publicKey)
  const usdcBalance = account.balances.find(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer
  )
  return usdcBalance?.balance ?? "0"
}
```

### 5.4 Send USDC payment

Used for cash-out (sending to CoinDCX deposit address):

```typescript
// lib/stellar/payment.ts
export async function sendUsdc(
  fromSecret: string,
  toAddress: string,
  amount: string,   // e.g. "400.000000"
  memo?: string
) {
  const keypair = Keypair.fromSecret(fromSecret)
  const account = await server.loadAccount(keypair.publicKey())
  const usdcAsset = new Asset(USDC.code, USDC.issuer)

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK.mainnet.networkPassphrase
  }).addOperation(Operation.payment({
    destination: toAddress,
    asset: usdcAsset,
    amount: amount
  }))

  if (memo) builder.addMemo(Memo.text(memo))

  const tx = builder.setTimeout(30).build()
  tx.sign(keypair)
  const result = await server.submitTransaction(tx)
  return result.hash  // transaction hash
}
```

---

## 6. Invoice System

### 6.1 Create invoice

**Route:** `POST /api/invoices`

**Auth:** Required (JWT session)

**Input:**
```typescript
{
  clientName: string,
  clientEmail?: string,
  amountUsd: number,           // e.g. 400.00
  description: string,
  dueDate?: string,            // ISO date
  lineItems?: Array<{
    description: string,
    qty: number,
    rate: number,
    total: number
  }>,
  purposeCode?: string         // default "P0802"
}
```

**Process:**
1. Validate with Zod
2. Generate `invoiceNumber` — sequential per user: `INV-2026-001`
3. Generate `paySlug` — `nanoid(10)` e.g. `"abc123xyzw"`
4. Generate `stellarMemo` — `"RUPI-" + padded sequence` e.g. `"RUPI-0042"` (max 28 chars — Stellar text memo limit)
5. Insert to DB with status `DRAFT`
6. If `clientEmail` provided, send invoice email via Resend
7. Return invoice object

**Output:**
```typescript
{
  id: string,
  invoiceNumber: string,
  paySlug: string,
  stellarMemo: string,
  payLink: "https://rupi.in/pay/abc123xyzw",
  status: "DRAFT"
}
```

### 6.2 Get invoice list

**Route:** `GET /api/invoices?status=PAID&page=1&limit=20`

**Output:**
```typescript
{
  invoices: Invoice[],
  total: number,
  page: number,
  hasMore: boolean
}
```

### 6.3 Public pay page data

**Route:** `GET /api/pay/[slug]`

**Auth:** None (public)

**Output:**
```typescript
{
  invoiceNumber: string,
  clientName: string,
  amountUsd: string,
  description: string,
  dueDate: string | null,
  lineItems: LineItem[] | null,
  status: "DRAFT" | "SENT" | "PAID",
  // Payment instructions for the client:
  paymentAddress: string,   // freelancer's Stellar public key
  stellarMemo: string,      // REQUIRED: client MUST include this memo
  asset: "USDC",
  network: "Stellar",
  assetIssuer: string       // Circle's issuer address
}
```

This powers the `/pay/[slug]` public page — the client sees exactly where to send USDC and which memo to include.

### 6.4 Invoice email (Resend)

```typescript
// lib/email/sendInvoice.ts
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendInvoiceEmail({
  toEmail,
  fromName,
  invoiceNumber,
  amountUsd,
  payLink,
  dueDate
}: SendInvoiceParams) {
  return resend.emails.send({
    from: "invoices@rupi.in",
    to: toEmail,
    subject: `Invoice ${invoiceNumber} from ${fromName} — $${amountUsd} USDC`,
    html: `
      <p>Hi,</p>
      <p>${fromName} has sent you an invoice for <strong>$${amountUsd} USDC</strong>.</p>
      <p>Pay here: <a href="${payLink}">${payLink}</a></p>
      <p>Payment is made via Stellar network in USDC stablecoin. 
         Instructions are on the payment page.</p>
      ${dueDate ? `<p>Due by: ${dueDate}</p>` : ""}
    `
  })
}
```

---

## 7. Payment Detection (Horizon Event Stream)

This is the most critical infrastructure piece. It watches the Stellar ledger for USDC payments to the user's address, matches the memo to an invoice, and triggers downstream actions.

### 7.1 Architecture choice

Two options — use whichever fits your Vercel setup:

| Option | How | Best for |
|--------|-----|---------|
| SSE stream per user | Long-running Horizon stream | Self-hosted / Railway |
| Polling cron (every 30s) | Horizon payments API | Vercel (recommended) |

**Recommended for Vercel: polling cron every 30 seconds** using Vercel's cron feature.

### 7.2 Horizon payment watcher (cron)

```typescript
// app/api/cron/check-payments/route.ts
// Called every 30s by Vercel cron (set in vercel.json)

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Horizon } from "@stellar/stellar-sdk"
import { processIncomingPayment } from "@/lib/stellar/payment-processor"

const horizonServer = new Horizon.Server("https://horizon.stellar.org")

export async function GET(request: Request) {
  // Verify it's a legitimate cron call
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get all users who have active invoices in SENT status
  const activeUsers = await prisma.user.findMany({
    where: {
      invoices: { some: { status: { in: ["SENT", "DRAFT"] } } }
    },
    include: {
      invoices: { where: { status: { in: ["SENT", "DRAFT"] } } }
    }
  })

  const results = []

  for (const user of activeUsers) {
    // Get payments to this user's Stellar address in last 5 minutes
    // (with cursor tracking to avoid re-processing)
    const lastEvent = await prisma.stellarEvent.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    })

    const payments = await horizonServer
      .payments()
      .forAccount(user.stellarPubKey)
      .cursor(lastEvent?.ledger?.toString() ?? "now")
      .order("asc")
      .limit(50)
      .call()

    for (const payment of payments.records) {
      // Only process USDC payments
      if (
        payment.type !== "payment" ||
        payment.asset_code !== "USDC" ||
        payment.asset_issuer !== USDC.issuer ||
        payment.to !== user.stellarPubKey
      ) continue

      // Dedup — skip if already processed
      const exists = await prisma.stellarEvent.findUnique({
        where: { txHash: payment.transaction_hash }
      })
      if (exists) continue

      // Get the memo from the transaction
      const tx = await horizonServer.transactions()
        .transaction(payment.transaction_hash)
        .call()
      const memo = tx.memo ?? null

      await processIncomingPayment({
        userId: user.id,
        txHash: payment.transaction_hash,
        amount: payment.amount,
        memo,
        ledger: BigInt(payment.paging_token),
        userInvoices: user.invoices
      })

      results.push({ txHash: payment.transaction_hash, memo })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
```

### 7.3 Payment processor

```typescript
// lib/stellar/payment-processor.ts
export async function processIncomingPayment({
  userId, txHash, amount, memo, ledger, userInvoices
}) {
  // 1. Record the event (always, even if no invoice match)
  await prisma.stellarEvent.create({
    data: {
      userId,
      txHash,
      eventType: "PAYMENT_RECEIVED",
      amountUsdc: parseFloat(amount),
      memo,
      ledger
    }
  })

  // 2. Match memo to invoice
  const matchedInvoice = userInvoices.find(inv => inv.stellarMemo === memo)
  
  if (matchedInvoice) {
    // 3. Mark invoice as paid
    await prisma.invoice.update({
      where: { id: matchedInvoice.id },
      data: {
        status: "PAID",
        amountReceivedUsdc: parseFloat(amount),
        stellarTxHash: txHash,
        paidAt: new Date()
      }
    })

    // 4. If user has yield enabled, deposit to Blend
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (user?.yieldEnabled) {
      await depositToBlend(userId, user.stellarSecretEnc, amount)
    }

    // 5. Send payment confirmation email
    if (matchedInvoice.clientEmail) {
      await sendPaymentConfirmationEmail({
        userId,
        invoiceId: matchedInvoice.id,
        amount,
        txHash
      })
    }
  }
}
```

---

## 8. Yield Module (Blend Protocol)

### 8.1 How Blend lending works

Blend's USDC lending pool accepts USDC deposits via the `submit()` function on the pool contract. The pool returns `bTokens` representing the depositor's share. To withdraw, call `submit()` with a withdraw request. Interest accrues in the bToken exchange rate — more USDC per bToken over time.

**Contract interaction method:** Soroban RPC `simulateTransaction` + `sendTransaction`

### 8.2 Install Blend SDK

The Blend contract SDK is Rust-only. For JavaScript, you interact with Blend via the Soroban RPC directly using `@stellar/stellar-sdk`'s `rpc.Server`:

```typescript
// lib/blend/client.ts
import { rpc, Networks, Keypair, TransactionBuilder, BASE_FEE, xdr, Address, nativeToScVal, scValToNative } from "@stellar/stellar-sdk"
import { BLEND, STELLAR_NETWORK, USDC } from "@/lib/stellar/constants"

const sorobanServer = new rpc.Server(STELLAR_NETWORK.mainnet.sorobanRpcUrl)
```

### 8.3 Deposit to Blend (supply USDC)

```typescript
// lib/blend/deposit.ts
import { Contract, xdr, Address, nativeToScVal } from "@stellar/stellar-sdk"

export async function depositToBlend(
  userId: string,
  encryptedSecret: string,
  amountStr: string  // e.g. "400.000000"
) {
  const secret = decryptSecret(encryptedSecret)
  const keypair = Keypair.fromSecret(secret)
  const amount = Math.floor(parseFloat(amountStr) * 1_000_000_0) // 7 decimals for Stellar

  const account = await sorobanServer.getAccount(keypair.publicKey())

  // Blend pool submit() takes a Request[] array
  // Request type 0 = SupplyCollateral, type 2 = Supply (lending)
  // For pure lending (earn yield), use type 2 (Supply)
  const requests = xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: nativeToScVal(BigInt(amount), { type: "i128" })
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("asset"),
        val: new Address(USDC.sacAddress).toScVal()
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("request_type"),
        val: nativeToScVal(2, { type: "u32" })  // 2 = Supply
      })
    ])
  ])

  const contract = new Contract(BLEND.usdcPool)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK.mainnet.networkPassphrase
  })
    .addOperation(contract.call(
      "submit",
      new Address(keypair.publicKey()).toScVal(),  // from
      new Address(keypair.publicKey()).toScVal(),  // spender
      new Address(keypair.publicKey()).toScVal(),  // to (receive bTokens)
      requests
    ))
    .setTimeout(30)
    .build()

  // Simulate first to get resource fees
  const simResult = await sorobanServer.simulateTransaction(tx)
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error(`Blend simulation failed: ${JSON.stringify(simResult)}`)
  }

  const assembledTx = rpc.assembleTransaction(tx, simResult).build()
  assembledTx.sign(keypair)

  const sendResult = await sorobanServer.sendTransaction(assembledTx)
  
  // Poll for confirmation
  let getResult = await sorobanServer.getTransaction(sendResult.hash)
  while (getResult.status === "NOT_FOUND") {
    await new Promise(r => setTimeout(r, 2000))
    getResult = await sorobanServer.getTransaction(sendResult.hash)
  }

  if (getResult.status !== "SUCCESS") {
    throw new Error(`Blend deposit failed: ${getResult.status}`)
  }

  // Update yield_positions in DB
  await updateYieldPosition(userId, amountStr, sendResult.hash)

  return sendResult.hash
}
```

### 8.4 Withdraw from Blend

```typescript
// lib/blend/withdraw.ts

export async function withdrawFromBlend(
  userId: string,
  encryptedSecret: string,
  amountStr: string
) {
  const secret = decryptSecret(encryptedSecret)
  const keypair = Keypair.fromSecret(secret)
  const amount = Math.floor(parseFloat(amountStr) * 1_000_000_0)

  const account = await sorobanServer.getAccount(keypair.publicKey())

  // Request type 3 = Withdraw (lending)
  const requests = xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: nativeToScVal(BigInt(amount), { type: "i128" })
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("asset"),
        val: new Address(USDC.sacAddress).toScVal()
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("request_type"),
        val: nativeToScVal(3, { type: "u32" })  // 3 = Withdraw
      })
    ])
  ])

  const contract = new Contract(BLEND.usdcPool)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK.mainnet.networkPassphrase
  })
    .addOperation(contract.call(
      "submit",
      new Address(keypair.publicKey()).toScVal(),
      new Address(keypair.publicKey()).toScVal(),
      new Address(keypair.publicKey()).toScVal(),
      requests
    ))
    .setTimeout(30)
    .build()

  const simResult = await sorobanServer.simulateTransaction(tx)
  const assembledTx = rpc.assembleTransaction(tx, simResult).build()
  assembledTx.sign(keypair)

  const sendResult = await sorobanServer.sendTransaction(assembledTx)

  // Poll for confirmation
  let getResult = await sorobanServer.getTransaction(sendResult.hash)
  while (getResult.status === "NOT_FOUND") {
    await new Promise(r => setTimeout(r, 2000))
    getResult = await sorobanServer.getTransaction(sendResult.hash)
  }

  // Update yield position to withdrawn
  await prisma.yieldPosition.update({
    where: { userId },
    data: { status: "withdrawn", depositedUsdc: 0, bTokensHeld: 0 }
  })

  return sendResult.hash
}
```

### 8.5 Yield toggle API

**Route:** `POST /api/yield/toggle`

**Auth:** Required

**Input:**
```typescript
{ enable: boolean }
```

**Process:**
- If `enable = true`:
  1. Get user's current USDC balance
  2. Call `depositToBlend(userId, encSecret, balance)`
  3. Set `user.yieldEnabled = true`
- If `enable = false`:
  1. Get yield position
  2. Call `withdrawFromBlend(userId, encSecret, position.depositedUsdc)`
  3. Set `user.yieldEnabled = false`

**Output:**
```typescript
{
  success: true,
  yieldEnabled: boolean,
  txHash: string,
  message: string
}
```

### 8.6 Yield status API

**Route:** `GET /api/yield/status`

**Process:**
1. Query `yield_positions` for user
2. Call Blend pool's `get_user_positions()` via Soroban RPC to get live bToken value
3. Compute earned = current value − deposited principal
4. Update `yield_positions.earnedUsdc` and `currentApy`

**Output:**
```typescript
{
  enabled: boolean,
  depositedUsdc: string,
  currentValueUsdc: string,
  earnedUsdc: string,
  currentApy: string,          // e.g. "4.20"
  lastSyncedAt: string
}
```

---

## 9. Cash-Out Flow (USDC → INR)

### 9.1 Architecture — fully server-side, user touches nothing

The user clicks "Cash out to INR" in Rupi. INR lands in their bank. They never open another app.

```
User: "Cash out"  →  Rupi frontend
                           │
                    POST /api/cashout/initiate
                           │
                    Rupi backend
                    ├── 1. withdrawFromBlend() if yield active
                    ├── 2. Bridge.xyz Orchestration API
                    │       source: stellar USDC (native)
                    │       destination: INR bank account (IFSC)
                    │       Bridge handles: FX + IMPS/NEFT + compliance
                    └── 3. Webhook → mark COMPLETE → PDF auto-generated
                                          │
                                   User's bank account
                                   INR credited ✓
```

### 9.2 Off-ramp decision

| Route | When | Stellar USDC | INR to bank | User action |
|-------|------|-------------|-------------|-------------|
| **Bridge.xyz** (primary) | `BRIDGE_API_KEY` set + user KYC done | ✅ Native | ✅ Direct IMPS/NEFT | None |
| **CoinDCX** (last resort) | Bridge not yet approved | ✅ Native | ⚠️ User sells manually | Open CoinDCX app |

> **Why Bridge is primary:** Stellar USDC natively supported. KYB is one-time for Rupi as a platform. Per-user KYC is automated via Bridge's KYC Links API — user gets a link, submits PAN/Aadhaar in Bridge's own UI, approved in minutes. India is explicitly a supported market (confirmed via Airtm case study on Bridge's site). No Rise Works — it does not support Stellar USDC, EVM-only.

---

### 9.3 Bridge.xyz integration (primary route)

#### One-time setup (your KYB)

Apply at `bridge.xyz` → "Get Access". You submit:
- Company name, registration, address
- UBO identity docs
- Use case: "Stellar USDC invoicing platform, INR payouts to Indian freelancers"

Approval: 1–2 business days. You get `BRIDGE_API_KEY`.

#### Per-user KYC (automated via KYC Links)

During Rupi onboarding, after user enters bank details:

```typescript
// lib/bridge/kyc.ts

const BRIDGE_API_BASE = "https://api.bridge.xyz/v0"
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY!

// Called during onboarding — generates a KYC link for the user
export async function createBridgeKycLink(user: {
  name: string,
  email: string
}): Promise<{ kycLink: string, tosLink: string, customerId: string }> {
  const res = await fetch(`${BRIDGE_API_BASE}/kyc_links`, {
    method: "POST",
    headers: {
      "Api-Key": BRIDGE_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": `kyc-${user.email}`
    },
    body: JSON.stringify({
      full_name: user.name,
      email: user.email,
      type: "individual"
    })
  })
  const data = await res.json()
  // data.kyc_link  — send this URL to the user (opens Bridge's KYC UI)
  // data.tos_link  — user must accept Bridge ToS first
  // data.customer_id — store this on user row as bridgeCustomerId
  return {
    kycLink: data.kyc_link,
    tosLink: data.tos_link,
    customerId: data.customer_id
  }
}

// Webhook from Bridge when KYC status changes
// POST /api/webhooks/bridge-kyc
export async function handleBridgeKycWebhook(payload: {
  customer_id: string,
  kyc_status: "approved" | "rejected" | "under_review"
}) {
  await prisma.user.updateMany({
    where: { bridgeCustomerId: payload.customer_id },
    data: { bridgeKycStatus: payload.kyc_status }
  })
}
```

User flow: Rupi shows "Complete identity verification" button → opens `tosLink` then `kycLink` in a new tab → Bridge handles ID collection → webhook fires → user's `bridgeKycStatus` = `"approved"` → cashout unlocked.

#### Initiate cashout via Bridge Orchestration API

```typescript
// lib/bridge/cashout.ts

export async function initiateBridgeCashout({
  bridgeCustomerId,
  amountUsdc,        // e.g. "400.123456"
  bankIfsc,
  bankAccount,
  bankName,
  accountHolderName,
  purposeCode,       // "P0802"
  idempotencyKey     // cashout.id — prevent double sends
}: BridgeCashoutParams): Promise<BridgeTransfer> {
  const res = await fetch(`${BRIDGE_API_BASE}/transfers`, {
    method: "POST",
    headers: {
      "Api-Key": BRIDGE_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      amount: amountUsdc,
      on_behalf_of: bridgeCustomerId,
      source: {
        payment_rail: "stellar",
        currency: "usdc"
        // Bridge watches for USDC arriving on Stellar to the
        // virtual account address it provides — see 9.3 onboarding
      },
      destination: {
        payment_rail: "inr_bank_transfer",  // verify exact rail name in sandbox
        currency: "inr",
        to_address: {
          account_number: bankAccount,
          routing_number: bankIfsc,         // Bridge uses routing_number for IFSC
          bank_name: bankName,
          account_type: "checking",
          account_holder_name: accountHolderName,
          country: "IN"
        }
      },
      developer_fee: "0",                  // set your fee here if charging
      reference: `${purposeCode}-${idempotencyKey.slice(0, 8)}`
    })
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Bridge transfer failed: ${JSON.stringify(err)}`)
  }

  return res.json()
  // Returns:
  // {
  //   id: string,                  — store as bridgeTransferId
  //   state: "awaiting_funds"      — transitions as Bridge processes
  //          | "in_review"
  //          | "funds_received"
  //          | "payment_submitted"
  //          | "payment_processed"
  //          | "undeliverable"
  //          | "refunded",
  //   source_deposit_instructions: {
  //     payment_rail: "stellar",
  //     usdc_address: string,      — send USDC HERE on Stellar
  //     usdc_memo: string          — include this memo
  //   },
  //   receipt: { ... }             — populated when complete
  // }
}
```

> **Critical:** Bridge returns a `source_deposit_instructions.usdc_address` — a Stellar address where YOU send the USDC. This is NOT the user's Stellar address. After calling this API, immediately call `sendUsdc()` from `lib/stellar/payment.ts` to send USDC from the user's custodial wallet to that Bridge deposit address with the provided memo. Bridge then detects the deposit and triggers the INR payout.

#### Full cashout sequence

```typescript
// lib/cashout/bridge-flow.ts

export async function executeBridgeCashout(cashoutId: string) {
  const cashout = await prisma.cashout.findUnique({
    where: { id: cashoutId },
    include: { user: true, invoice: true }
  })
  if (!cashout || !cashout.user.bridgeCustomerId) throw new Error("Bridge not set up")

  // Step 1: Create Bridge transfer — get deposit instructions
  const transfer = await initiateBridgeCashout({
    bridgeCustomerId: cashout.user.bridgeCustomerId,
    amountUsdc: cashout.usdcAmount.toString(),
    bankIfsc: cashout.user.bankIfsc!,
    bankAccount: cashout.user.bankAccount!,
    bankName: cashout.user.bankName!,
    accountHolderName: cashout.user.name,
    purposeCode: cashout.purposeCode,
    idempotencyKey: cashout.id
  })

  // Step 2: Send USDC from user's custodial wallet to Bridge's deposit address
  const userSecret = decryptSecret(cashout.user.stellarSecretEnc)
  const txHash = await sendUsdc(
    userSecret,
    transfer.source_deposit_instructions.usdc_address,
    cashout.usdcAmount.toString(),
    transfer.source_deposit_instructions.usdc_memo  // REQUIRED
  )

  // Step 3: Update DB
  await prisma.cashout.update({
    where: { id: cashoutId },
    data: {
      status: "USDC_SENT",
      stellarTxHash: txHash,
      bridgeTransferId: transfer.id,
      destinationAddr: transfer.source_deposit_instructions.usdc_address
    }
  })

  // Step 4: Wait for Bridge webhook — see 9.4
  return { txHash, bridgeTransferId: transfer.id }
}
```

#### Bridge webhook handler

```typescript
// app/api/webhooks/bridge/route.ts

import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get("bridge-signature") ?? ""

  // Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac("sha256", process.env.BRIDGE_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex")

  if (sig !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const payload = JSON.parse(rawBody)

  if (payload.event_type === "transfer.payment_processed") {
    const cashout = await prisma.cashout.findFirst({
      where: { bridgeTransferId: payload.data.id }
    })
    if (!cashout) return NextResponse.json({ ok: true })

    await prisma.cashout.update({
      where: { id: cashout.id },
      data: {
        status: "COMPLETE",
        inrActual: payload.data.receipt?.destination_tx_amount ?? null,
        firaReference: payload.data.receipt?.id ?? null,
        completedAt: new Date()
      }
    })

    // Auto-generate PDF receipt
    await generateAndStorePdfReceipt(cashout.id)
  }

  if (payload.event_type === "transfer.undeliverable") {
    const cashout = await prisma.cashout.findFirst({
      where: { bridgeTransferId: payload.data.id }
    })
    if (cashout) {
      await prisma.cashout.update({
        where: { id: cashout.id },
        data: { status: "FAILED" }
      })
      // TODO: refund USDC back to user's Stellar wallet
    }
  }

  return NextResponse.json({ ok: true })
}
```

---

### 9.4 CoinDCX fallback (last resort only)

Use this ONLY if Bridge KYB approval is not yet received when you need to demo or ship.

**What changes:** Rupi still automates steps 1–2 (Blend withdraw + USDC send). Steps 3–4 require the user to open CoinDCX, sell USDC for INR, and withdraw to bank. User must have pre-linked their CoinDCX Stellar USDC deposit address in Rupi settings.

```typescript
// lib/cashout/coindcx-flow.ts

export async function executeCoinDcxFallback(cashoutId: string) {
  const cashout = await prisma.cashout.findUnique({
    where: { id: cashoutId },
    include: { user: true }
  })

  const coindcxAddr = cashout?.user.coindcxStellarDepositAddr
  if (!coindcxAddr) throw new Error("CoinDCX deposit address not set")

  const userSecret = decryptSecret(cashout.user.stellarSecretEnc)
  const txHash = await sendUsdc(
    userSecret,
    coindcxAddr,
    cashout.usdcAmount.toString(),
    cashout.invoice?.invoiceNumber  // memo for reference
  )

  await prisma.cashout.update({
    where: { id: cashoutId },
    data: {
      status: "USDC_SENT",
      stellarTxHash: txHash,
      route: "coindcx",
      destinationAddr: coindcxAddr
    }
  })

  return {
    txHash,
    // Return manual instructions for UI to display
    nextSteps: [
      "Open CoinDCX app — USDC arrives in ~1 min",
      "Funds → USDC → Trade → Sell USDC/INR → confirm",
      "Funds → INR → Withdraw to bank",
      "Return here and tap 'Mark as received'"
    ]
  }
}
```

**CoinDCX route requires:** user to tap "Mark as received" manually → triggers PDF generation. No webhook available.

---

### 9.5 Route selector

```typescript
// lib/cashout/router.ts

export type CashoutRoute = "bridge" | "coindcx"

export async function selectCashoutRoute(userId: string): Promise<CashoutRoute> {
  const user = await prisma.user.findUnique({ where: { id: userId } })

  const bridgeReady =
    !!process.env.BRIDGE_API_KEY &&
    !!user?.bridgeCustomerId &&
    user?.bridgeKycStatus === "approved"

  if (bridgeReady) return "bridge"

  // Last resort — user must have set their CoinDCX deposit address
  if (user?.coindcxStellarDepositAddr) return "coindcx"

  throw new Error("No cashout route available — Bridge KYC pending or CoinDCX address not set")
}
```

---

### 9.6 Get cash-out quote

**Route:** `GET /api/cashout/quote?amount=400`

**Process:**
1. Fetch live USDC/INR rate from CoinDCX public ticker (no auth):
   `GET https://api.coindcx.com/exchange/ticker` → find `USDCINR` → `last_price`
2. Determine active route via `selectCashoutRoute()`
3. Calculate TDS estimate

**Output:**
```typescript
{
  usdcAmount: "400.000000",
  inrRateIndicative: "83.51",     // CoinDCX spot — Bridge will have own FX rate
  inrEstimate: "33404.00",
  tdsEstimate: "334.04",          // 1% TDS shown for awareness (Bridge handles deduction)
  netInrEstimate: "33069.96",
  activeRoute: "bridge" | "coindcx",
  fullyAutomated: boolean,        // true for bridge, false for coindcx
  rateUpdatedAt: "2026-06-25T10:30:00Z",
  note: "Final INR amount set by Bridge at time of conversion"
}
```

### 9.7 Initiate cash-out API

**Route:** `POST /api/cashout/initiate`

**Input:**
```typescript
{
  invoiceId?: string,
  usdcAmount: string,
  includeYield: boolean,
  purposeCode: string     // "P0802" | "P0803" | "P1006"
}
```

**Process:**
1. Validate USDC balance ≥ `usdcAmount`
2. If `includeYield` and yield enabled → call `withdrawFromBlend()`, poll until confirmed
3. Call `selectCashoutRoute(userId)` → `"bridge"` or `"coindcx"`
4. Create `cashout` DB record with status `INITIATED`
5. **Bridge route** → call `executeBridgeCashout(cashout.id)`
6. **CoinDCX route** → call `executeCoinDcxFallback(cashout.id)`
7. Record `StellarEvent` of type `CASHOUT_SEND`
8. If `invoiceId` provided → update invoice status to `CASHED_OUT`

**Output:**
```typescript
{
  cashoutId: string,
  route: "bridge" | "coindcx",
  stellarTxHash: string,
  usdcSent: string,
  inrEstimate: string,
  fullyAutomated: boolean,
  // Bridge route — nothing else needed, webhook handles the rest
  // CoinDCX route only:
  nextSteps?: string[]
}
```

### 9.8 Mark complete (CoinDCX route only)

**Route:** `PATCH /api/cashout/[id]/complete`

Not needed for Bridge route — webhook auto-completes. Only for CoinDCX fallback.

1. Update `status = "COMPLETE"`, set `completedAt`
2. Trigger `generateAndStorePdfReceipt(cashoutId)`

### 9.9 Rate fetch utility

```typescript
// lib/coindcx/rate.ts
export async function getUsdcInrRate(): Promise<number> {
  const res = await fetch("https://api.coindcx.com/exchange/ticker", {
    next: { revalidate: 30 }
  })
  const tickers = await res.json()
  const usdcInr = tickers.find((t: any) => t.market === "USDCINR")
  if (!usdcInr) throw new Error("USDCINR ticker not found")
  return parseFloat(usdcInr.last_price)
}
```

### 9.10 DB schema additions

```prisma
// Add to users:
bridgeCustomerId       String?   // set after Bridge KYC link created
bridgeKycStatus        String?   // "approved" | "rejected" | "under_review"
coindcxStellarDepositAddr String? // fallback only — user's CoinDCX Stellar USDC addr

// Add to cashouts:
route                  String    @default("bridge")  // "bridge" | "coindcx"
bridgeTransferId       String?   // Bridge transfer ID
inrActual              Decimal?  @db.Decimal(14, 2)  // confirmed from Bridge receipt
firaReference          String?   // Bridge receipt ID — use for FEMA records
```

### 9.11 Environment variables for this section

```bash
# Bridge (primary)
BRIDGE_API_KEY="<from Bridge dashboard after KYB approval>"
BRIDGE_WEBHOOK_SECRET="<from Bridge dashboard>"

# No separate env needed for CoinDCX fallback —
# user's deposit address stored in DB, rate from public API
```

### 9.12 Sandbox testing checklist

Before going live, verify in Bridge sandbox:

- [ ] KYC link flow completes for a test user with Indian PAN/Aadhaar
- [ ] `POST /v0/transfers` with `payment_rail: "stellar"` source accepts Stellar USDC
- [ ] Confirm exact `destination.payment_rail` value for India — likely `"inr_bank_transfer"` — check Bridge docs or email `support@bridge.xyz`
- [ ] Webhook fires `transfer.payment_processed` after simulated settlement
- [ ] `receipt.destination_tx_amount` contains actual INR sent
- [ ] Test with a real Indian bank account (yours) to verify IMPS/NEFT lands correctly

---

## 10. Compliance & Documentation

### 10.1 RBI Purpose Codes

| Code | Description | Use case |
|------|-------------|----------|
| P0802 | Software Consultancy Services | Software dev, IT consulting |
| P0803 | Information Services | Data, research, analytics |
| P1006 | Other Business Services | Freelance, design, writing |
| P1007 | Operational Leasing | SaaS subscriptions (for B2B) |

Store as dropdown during invoice creation. Auto-fills from user default.

### 10.2 PDF receipt generation

Generated after cashout is marked complete. Uses Puppeteer on Vercel via `@sparticuz/chromium`.

```typescript
// lib/pdf/generateReceipt.ts
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"

export async function generateCashoutReceipt(cashout: CashoutWithInvoice, user: User) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true
  })

  const page = await browser.newPage()
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head><style>
      body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
      .header { border-bottom: 2px solid #1D9E75; padding-bottom: 16px; margin-bottom: 24px; }
      .row { display: flex; justify-content: space-between; margin: 8px 0; }
      .label { color: #666; }
      .value { font-weight: 500; }
      .warning { background: #FAEEDA; padding: 12px; border-radius: 6px; font-size: 12px; margin-top: 24px; }
      .mono { font-family: monospace; font-size: 11px; word-break: break-all; }
    </style></head>
    <body>
      <div class="header">
        <h2 style="color:#1D9E75;margin:0">Rupi</h2>
        <p style="margin:4px 0;color:#666">Foreign Payment Receipt — For FEMA/GST records</p>
      </div>

      <div class="row"><span class="label">Receipt Date</span>
        <span class="value">${new Date().toLocaleDateString("en-IN")}</span></div>
      <div class="row"><span class="label">Freelancer</span>
        <span class="value">${user.name}</span></div>
      <div class="row"><span class="label">PAN</span>
        <span class="value">${user.pan ?? "Not provided"}</span></div>
      <div class="row"><span class="label">Invoice #</span>
        <span class="value">${cashout.invoice?.invoiceNumber ?? "N/A"}</span></div>
      <div class="row"><span class="label">Client</span>
        <span class="value">${cashout.invoice?.clientName ?? "N/A"}</span></div>
      <div class="row"><span class="label">USDC Amount</span>
        <span class="value">$${cashout.usdcAmount}</span></div>
      <div class="row"><span class="label">INR Rate (at initiation)</span>
        <span class="value">₹${cashout.inrRateSnapshot} / USDC</span></div>
      <div class="row"><span class="label">Estimated INR</span>
        <span class="value">₹${cashout.inrEstimate}</span></div>
      <div class="row"><span class="label">RBI Purpose Code</span>
        <span class="value">${cashout.purposeCode}</span></div>
      <div class="row"><span class="label">Stellar Tx Hash</span>
        <span class="mono">${cashout.stellarTxHash}</span></div>
      <div class="row"><span class="label">Destination (CoinDCX)</span>
        <span class="mono">${cashout.destinationAddr}</span></div>
      <div class="row"><span class="label">Network</span>
        <span class="value">Stellar (USDC)</span></div>

      <div class="warning">
        <strong>FEMA Compliance Note:</strong> This receipt documents the foreign inward
        remittance received as payment for export of services. Request a FIRC (Foreign
        Inward Remittance Certificate) from your bank after INR credit.
        Purpose Code ${cashout.purposeCode} applies. Keep this receipt for ITR filing.
        1% TDS (Sec 194S) of ₹${cashout.tdsAmount} may be deducted by the exchange.
      </div>
    </body>
    </html>
  `)

  const pdf = await page.pdf({ format: "A4", printBackground: true })
  await browser.close()
  return pdf  // Buffer — upload to Supabase Storage or return directly
}
```

**Route:** `GET /api/cashout/[id]/receipt` — returns PDF with correct headers.

---

## 11. API Route Reference

### Complete route map

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | No | Create account + Stellar keypair |
| POST | `/api/auth/[...nextauth]` | — | NextAuth handler |
| PATCH | `/api/user/profile` | Yes | Update name, PAN, GST, bank details |
| PATCH | `/api/user/coindcx` | Yes | Save CoinDCX Stellar deposit address |
| GET | `/api/invoices` | Yes | List invoices (paginated, filterable) |
| POST | `/api/invoices` | Yes | Create invoice |
| GET | `/api/invoices/[id]` | Yes | Get single invoice with full detail |
| PATCH | `/api/invoices/[id]` | Yes | Update draft invoice |
| DELETE | `/api/invoices/[id]` | Yes | Delete draft invoice |
| GET | `/api/pay/[slug]` | No | Public pay page data |
| GET | `/api/wallet/balance` | Yes | USDC balance from Horizon |
| GET | `/api/wallet/transactions` | Yes | Recent stellar events from DB |
| POST | `/api/yield/toggle` | Yes | Enable/disable Blend yield |
| GET | `/api/yield/status` | Yes | Current yield position + APY |
| GET | `/api/cashout/quote` | Yes | Live USDC/INR rate + estimate |
| POST | `/api/cashout/initiate` | Yes | Start cashout (withdraw Blend + send USDC) |
| PATCH | `/api/cashout/[id]/complete` | Yes | Mark cashout done, trigger PDF |
| GET | `/api/cashout/[id]/receipt` | Yes | Download PDF receipt |
| GET | `/api/cron/check-payments` | Cron | Poll Horizon for new payments |
| POST | `/api/cron/yield-sync` | Cron | Update yield positions from Blend |

---

## 12. Cron Jobs

### `vercel.json` cron config

```json
{
  "crons": [
    {
      "path": "/api/cron/check-payments",
      "schedule": "*/1 * * * *"
    },
    {
      "path": "/api/cron/yield-sync",
      "schedule": "0 * * * *"
    }
  ]
}
```

### Yield sync cron

**Route:** `POST /api/cron/yield-sync`

**Process:**
1. Get all active yield positions
2. For each, call Blend pool's `get_user_positions()` on Soroban RPC
3. Calculate current USDC value of bTokens
4. Update `earnedUsdc = currentValue - depositedUsdc`
5. Fetch pool APY from Blend's `get_reserve_data()` call
6. Update `currentApy` and `lastSyncedAt`

---

## 13. Frontend Pages & Components

### Page structure (`/app/`)

```
app/
├── (auth)/
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── onboarding/
│       ├── profile/page.tsx
│       ├── compliance/page.tsx
│       └── bank/page.tsx
├── (dashboard)/
│   ├── layout.tsx           ← sidebar + auth guard
│   ├── page.tsx             ← dashboard home
│   ├── invoices/
│   │   ├── page.tsx         ← invoice list
│   │   ├── new/page.tsx     ← create invoice
│   │   └── [id]/page.tsx    ← invoice detail
│   ├── yield/page.tsx       ← yield toggle + stats
│   └── cashout/page.tsx     ← initiate cash out
├── pay/
│   └── [slug]/page.tsx      ← PUBLIC pay page (no auth)
└── api/
    └── ...                  ← all API routes
```

### Key component: `<PayPage />` (`/pay/[slug]`)

This is what the client sees. No login required. Shows:
- Invoice details (amount, from, description)
- Payment instructions box with copyable Stellar address and memo
- Warning: "You MUST include the memo `RUPI-001` or payment won't be matched"
- QR code of the Stellar address (use `qrcode.react`)
- Asset: USDC · Network: Stellar

### Key component: `<YieldToggle />`

```tsx
// components/YieldToggle.tsx
"use client"
import { useState } from "react"

export function YieldToggle({ initialEnabled, earnedUsdc, apy }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    setLoading(true)
    const res = await fetch("/api/yield/toggle", {
      method: "POST",
      body: JSON.stringify({ enable: !enabled })
    })
    const data = await res.json()
    if (data.success) setEnabled(!enabled)
    setLoading(false)
  }

  return (
    <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
      <div>
        <p className="text-sm font-medium">Yield (Blend Protocol)</p>
        <p className="text-xs text-gray-500">{apy}% APY · +${earnedUsdc} earned</p>
        <p className="text-xs text-gray-400">Your idle USDC earns in Blend's lending pool</p>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        className={`w-12 h-6 rounded-full transition-colors ${
          enabled ? "bg-green-500" : "bg-gray-300"
        }`}
      >
        <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${
          enabled ? "translate-x-6" : "translate-x-0"
        }`} />
      </button>
    </div>
  )
}
```

---

## 14. Environment Variables

```bash
# .env.local

# Database
DATABASE_URL="postgresql://..."

# Auth
NEXTAUTH_SECRET="<random 32 char>"
NEXTAUTH_URL="https://rupi.in"

# Stellar
STELLAR_NETWORK="mainnet"                  # or "testnet"
STELLAR_ENCRYPTION_KEY="<random 32 char>" # for AES encrypting user secrets
STELLAR_PLATFORM_PUBKEY="G..."            # platform account (pays XLM for new accounts)
STELLAR_PLATFORM_SECRET="S..."            # platform account secret

# Cron security
CRON_SECRET="<random 32 char>"

# Email
RESEND_API_KEY="re_..."

# App
NEXT_PUBLIC_APP_URL="https://rupi.in"
NEXT_PUBLIC_STELLAR_NETWORK="mainnet"
```

---

## 15. Third-Party SDKs & Contracts Reference

### SDKs

| SDK | Package | Version | Used for |
|-----|---------|---------|----------|
| Stellar SDK (JS) | `@stellar/stellar-sdk` | ^12.x | Keypairs, transactions, Horizon, Soroban RPC |
| Freighter API | `@stellar/freighter-api` | ^2.x | Optional non-custodial wallet connect |
| NextAuth | `next-auth` | ^4.x | Session management |
| Prisma | `@prisma/client` | ^5.x | DB ORM |
| Resend | `resend` | ^3.x | Transactional email |
| Puppeteer-core | `puppeteer-core` | ^21.x | PDF generation |
| Chromium | `@sparticuz/chromium` | ^119.x | Headless Chrome on Vercel |
| CryptoJS | `crypto-js` | ^4.x | Secret key encryption |
| Zod | `zod` | ^3.x | Input validation |
| nanoid | `nanoid` | ^5.x | Pay slug generation |

### Deployed contract addresses (Stellar Mainnet)

| Contract | Address |
|----------|---------|
| USDC Issuer (Classic) | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| USDC SAC (Soroban) | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUD` |
| Blend Pool Factory | `CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU` |
| Blend Backstop | `CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7` |
| Blend USDC Pool | **Verify at docs.blend.capital/mainnet-deployments** |

### Public APIs (no auth)

| API | URL | Used for |
|-----|-----|---------|
| Horizon mainnet | `https://horizon.stellar.org` | Account data, payment history |
| Soroban RPC | `https://soroban-rpc.stellar.org` | Smart contract calls (Blend) |
| CoinDCX ticker | `https://api.coindcx.com/exchange/ticker` | USDC/INR live rate |
| Stellar testnet faucet | `https://friendbot.stellar.org/?addr=<key>` | Fund testnet accounts |

---

## 16. Security Considerations

### Critical points

| Risk | Mitigation |
|------|-----------|
| User's Stellar secret exposed | AES-256 encrypted at rest; decrypted only in API routes on server; never sent to client |
| `STELLAR_ENCRYPTION_KEY` leak | Store only in Vercel env; never log; rotate requires re-encrypting all secrets |
| CSRF on payment actions | NextAuth CSRF tokens on all mutations; verify session on every API route |
| Replay attacks on payment processing | `StellarEvent.txHash` unique constraint — same tx never processed twice |
| Cron endpoint abuse | `CRON_SECRET` bearer token; only Vercel's cron IP can call it |
| Client sends wrong memo | Memo mismatch means no invoice match — funds still received but shown as "unmatched payment" in stellar_events; notify user to check manually |
| Blend contract risk | Blend is non-custodial and audited; warn users in yield toggle UI |
| Rate limit on Horizon | SDF allows 3600 requests/hour on public endpoint; use cursor-based polling not full account history |

### Key invariants

1. **Never send `stellarSecretEnc` or decrypted secret to the frontend.**
2. **Always verify `session.user.id` matches the resource's `userId` before any mutation.**
3. **Process each `txHash` only once** — check `StellarEvent` table first.
4. **Amounts in DB use Decimal/string, not floating point.**

---

## 17. Hackathon Demo Script

### 5-minute demo flow (for Demo Day)

**Setup before demo:**
- Have testnet (or mainnet with small amounts) account pre-funded
- Have a second device (phone) with a Stellar wallet (Lobstr app) loaded with 10 USDC
- Have the live app open on a laptop

**Demo sequence:**

1. **(30s)** Show the dashboard — "$842 USDC balance, earning 4.2% APY on Blend"
2. **(45s)** Create a new invoice — client name: "Demo Ventures", $10 USDC, description: "API integration work"
3. **(15s)** Copy the pay link — open it on phone browser — show the Stellar address + memo
4. **(60s)** On phone (Lobstr app): send $10 USDC to the address with memo `RUPI-008`
5. **(60s)** Watch the dashboard — payment appears in ~5-10 seconds (Stellar settles in 5s; cron runs every 60s on Vercel — for demo, trigger the cron manually via a test endpoint)
6. **(30s)** Show invoice status flip from SENT → PAID, show Stellar tx hash link on Stellar Expert
7. **(45s)** Hit "Cash out" — show the CoinDCX flow explanation, show the initiation sending USDC to CoinDCX address
8. **(30s)** Show the PDF receipt download — FEMA note, purpose code, tx hash
9. **(15s)** Close: "This is the Kosh.money experience, but built natively on Stellar — 5 second settlement, near-zero fees, and Blend yield on idle funds."

**For the Blend demo:** pre-enable yield before the demo so you can show the "+$1.84 earned" number without needing to wait for accrual.

**Testnet note:** For the demo on testnet, use Stellar Lab to send USDC and trigger the cron webhook manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://yourapp.vercel.app/api/cron/check-payments`

---

*End of specification — total pages: ~30 equivalent*
*Build order: Auth → Stellar account → Invoice CRUD → Payment watcher → Yield toggle → Cash out → PDF*
