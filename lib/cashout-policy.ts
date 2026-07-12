export const CASHOUT_CAP_PER_TRANSACTION_INR = "25000.00";
export const CASHOUT_CAP_ROLLING_24H_INR = "50000.00";
export const RUPI_FEE_BPS = 50;

export type CashoutState =
  | "QUOTE_CREATED" | "KYC_REQUIRED" | "READY" | "AWAITING_STEP_UP" | "ORDER_CREATED" | "SIGNING"
  | "SUBMITTED" | "DEPOSIT_FOUND" | "SELLING" | "PAYOUT_INITIATED" | "PAID" | "EXPIRED"
  | "REJECTED" | "AMOUNT_MISMATCH" | "HELD" | "SUBMISSION_UNKNOWN" | "REFUND_PENDING"
  | "REFUNDED" | "MANUAL_REVIEW";

const transitions: Record<CashoutState, CashoutState[]> = {
  QUOTE_CREATED: ["KYC_REQUIRED", "READY", "EXPIRED"], KYC_REQUIRED: ["READY", "REJECTED", "HELD"],
  READY: ["AWAITING_STEP_UP", "EXPIRED", "HELD"], AWAITING_STEP_UP: ["ORDER_CREATED", "EXPIRED", "HELD"],
  ORDER_CREATED: ["SIGNING", "EXPIRED", "HELD", "MANUAL_REVIEW"], SIGNING: ["SUBMITTED", "SUBMISSION_UNKNOWN", "HELD", "MANUAL_REVIEW"],
  SUBMITTED: ["DEPOSIT_FOUND", "HELD", "SUBMISSION_UNKNOWN", "MANUAL_REVIEW", "REFUND_PENDING"],
  DEPOSIT_FOUND: ["SELLING", "HELD", "AMOUNT_MISMATCH", "REFUND_PENDING"], SELLING: ["PAYOUT_INITIATED", "HELD", "REFUND_PENDING"],
  PAYOUT_INITIATED: ["PAID", "HELD", "REFUND_PENDING"], PAID: [], EXPIRED: [], REJECTED: [],
  AMOUNT_MISMATCH: ["REFUND_PENDING", "MANUAL_REVIEW"], HELD: ["MANUAL_REVIEW", "REFUND_PENDING", "REJECTED"],
  SUBMISSION_UNKNOWN: ["SUBMITTED", "MANUAL_REVIEW", "REFUND_PENDING"], REFUND_PENDING: ["REFUNDED", "MANUAL_REVIEW"],
  REFUNDED: [], MANUAL_REVIEW: ["REFUND_PENDING", "REJECTED", "SUBMITTED"],
};

export function canTransitionCashout(from: CashoutState, to: CashoutState) {
  return transitions[from]?.includes(to) || false;
}

export function inrToPaise(value: string) {
  const raw = String(value || "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Provider returned an invalid INR amount.");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function paiseToInr(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function rupiFeeForGrossInr(grossInr: string) {
  const gross = inrToPaise(grossInr);
  return paiseToInr((gross * BigInt(RUPI_FEE_BPS) + 5_000n) / 10_000n);
}

export function rupiFeePaiseForGrossInr(grossInr: string) {
  return inrToPaise(rupiFeeForGrossInr(grossInr));
}

/** Reject a provider quote whose disclosed fees do not conserve its gross INR. */
export function assertCashoutQuoteBreakdown({
  grossInr,
  onrampFeeInr,
  gatewayFeeInr,
  tdsInr,
  rupiFeeInr,
  netInr,
}: {
  grossInr: string;
  onrampFeeInr: string;
  gatewayFeeInr: string;
  tdsInr: string;
  rupiFeeInr: string;
  netInr: string;
}) {
  const gross = inrToPaise(grossInr);
  const rupiFee = inrToPaise(rupiFeeInr);
  const expectedRupiFee = rupiFeePaiseForGrossInr(grossInr);
  if (gross <= 0n || rupiFee !== expectedRupiFee) {
    throw new Error("Cash-out quote does not contain the disclosed 0.5% Rupi fee.");
  }
  const net = inrToPaise(netInr);
  const expectedNet = gross - inrToPaise(onrampFeeInr) - inrToPaise(gatewayFeeInr) - inrToPaise(tdsInr) - rupiFee;
  if (expectedNet < 0n || net !== expectedNet) {
    throw new Error("Cash-out quote fee breakdown does not reconcile to its net INR settlement.");
  }
  return true;
}

export function isWithinCashoutLimits({ rollingInr, grossInr }: { rollingInr: string; grossInr: string }) {
  const gross = inrToPaise(grossInr);
  const rolling = inrToPaise(rollingInr);
  return gross <= inrToPaise(CASHOUT_CAP_PER_TRANSACTION_INR) && rolling + gross <= inrToPaise(CASHOUT_CAP_ROLLING_24H_INR);
}
