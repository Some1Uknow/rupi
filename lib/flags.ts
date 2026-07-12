export function isProductAppEnabled() {
  return process.env.ENABLE_PRODUCT_APP === "true";
}

export function isMainnetRelease() {
  return process.env.RUPI_ENVIRONMENT === "mainnet" && process.env.STELLAR_NETWORK === "mainnet";
}
