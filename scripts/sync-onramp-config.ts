import { syncOnrampConfiguration } from "../lib/cashout";

const result = await syncOnrampConfiguration();
process.stdout.write(`Synced Onramp configuration ${result.hash} for network ${result.networkId}\n`);
