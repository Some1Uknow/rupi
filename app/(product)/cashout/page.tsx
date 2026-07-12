import { requireUser } from "@/lib/auth";
import { getBeneficiary, getCashoutConfig, listCashoutOrders } from "@/lib/cashout";
import { PageHeader } from "@/components/product/Primitives";
import { CashoutFlow } from "@/components/product/CashoutFlow";

export default async function CashoutPage() {
  const user = await requireUser();
  const [beneficiary, orders, config] = await Promise.all([getBeneficiary(user.id).catch(() => null), listCashoutOrders(user.id).catch(() => []), getCashoutConfig(user.id).catch(() => ({ available: false, kycState: "NOT_STARTED", providerAvailable: false, beneficiary: null, caps: { perTransactionInr: "25000.00", rolling24hInr: "50000.00", rupiFeeBps: 50 } }))]);
  return <main className="rupi-page"><PageHeader title="Cash out" /><CashoutFlow initialBeneficiary={beneficiary} initialOrders={orders} initialConfig={config} /></main>;
}
