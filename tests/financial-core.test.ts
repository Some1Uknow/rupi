import assert from "node:assert/strict";
import test from "node:test";
import { calculateInvoiceLineItems } from "../lib/invoices";
import { normalizeStellarAmount, stellarAmountToStroops } from "../lib/stellar";
import {
  CASHOUT_CAP_PER_TRANSACTION_INR,
  CASHOUT_CAP_ROLLING_24H_INR,
  assertCashoutQuoteBreakdown,
  canTransitionCashout,
  isWithinCashoutLimits,
  rupiFeeForGrossInr,
} from "../lib/cashout-policy";
import { createHmac } from "node:crypto";
import { isFreshWebhookTimestamp, verifyHmacWebhook } from "../lib/providers/webhook";

test("Stellar amounts preserve seven-decimal precision without floating point", () => {
  assert.equal(normalizeStellarAmount("0001.2"), "1.2000000");
  assert.equal(stellarAmountToStroops("1.0000001"), 10_000_001n);
  assert.throws(() => normalizeStellarAmount("1.00000001"));
  assert.throws(() => normalizeStellarAmount("0"));
});

test("invoice totals are calculated server-side and ignore caller supplied totals", () => {
  const result = calculateInvoiceLineItems([
    { description: "Design", qty: "1.5", rate: "10", total: "0.01" },
    { description: "Implementation", qty: "2", rate: "4.25", total: "999999" },
  ]);
  assert.equal(result.lineItems[0].total, "15.0000000");
  assert.equal(result.lineItems[1].total, "8.5000000");
  assert.equal(result.amount, "23.5000000");
});

test("Rupi fee and cash-out caps are deterministic at paise precision", () => {
  assert.equal(rupiFeeForGrossInr("25000.00"), "125.00");
  assert.equal(CASHOUT_CAP_PER_TRANSACTION_INR, "25000.00");
  assert.equal(CASHOUT_CAP_ROLLING_24H_INR, "50000.00");
  assert.equal(isWithinCashoutLimits({ rollingInr: "24999.99", grossInr: "25000.00" }), true);
  assert.equal(isWithinCashoutLimits({ rollingInr: "25000.01", grossInr: "25000.00" }), false);
  assert.equal(isWithinCashoutLimits({ rollingInr: "0.00", grossInr: "25000.01" }), false);
});

test("provider quote fee breakdown conserves gross INR and includes the Rupi fee", () => {
  assert.doesNotThrow(() => assertCashoutQuoteBreakdown({
    grossInr: "100.00",
    onrampFeeInr: "1.00",
    gatewayFeeInr: "0.50",
    tdsInr: "0.00",
    rupiFeeInr: "0.50",
    netInr: "98.00",
  }));
  assert.throws(() => assertCashoutQuoteBreakdown({
    grossInr: "100.00",
    onrampFeeInr: "1.00",
    gatewayFeeInr: "0.50",
    tdsInr: "0.00",
    rupiFeeInr: "0.50",
    netInr: "99.00",
  }));
});

test("webhook signatures bind the raw body and a fresh timestamp", () => {
  const secret = "webhook-test-secret";
  const timestamp = String(Date.now());
  const rawBody = "{\"eventId\":\"evt_1\",\"status\":\"PAID\"}";
  const signature = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
  assert.equal(verifyHmacWebhook({ secret, rawBody, signature, timestamp }), true);
  assert.equal(verifyHmacWebhook({ secret, rawBody: rawBody + " ", signature, timestamp }), false);
  assert.equal(isFreshWebhookTimestamp(String(Date.now() - 6 * 60_000)), false);
});

test("cash-out state machine rejects skipped and terminal transitions", () => {
  assert.equal(canTransitionCashout("SUBMITTED", "DEPOSIT_FOUND"), true);
  assert.equal(canTransitionCashout("SUBMITTED", "PAID"), false);
  assert.equal(canTransitionCashout("PAID", "REFUND_PENDING"), false);
  assert.equal(canTransitionCashout("REFUND_PENDING", "REFUNDED"), true);
});
