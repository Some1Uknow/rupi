export const YIELD_UNAVAILABLE = {
  code: "YIELD_NOT_AVAILABLE",
  message: "Blend yield is not available in the Mainnet launch release.",
} as const;

export async function getYieldOverview() {
  return { position: null, balance: null, apy: null, live: false, available: false };
}

export async function listYieldActions() {
  return [];
}

export async function submitYieldAction() {
  throw new Error(YIELD_UNAVAILABLE.message);
}
