import { requireUser } from "@/lib/auth";
import { getWallet } from "@/lib/wallets";
import { PageHeader, ShortAddress } from "@/components/product/Primitives";
import { DeleteAccountRequest } from "@/components/product/DeleteAccountRequest";

export default async function SettingsPage() {
  const user = await requireUser(); const wallet = await getWallet(user.id).catch(() => null);
  return <main className="rupi-page"><PageHeader title="Settings" /><section className="rupi-split"><article className="rupi-surface"><div className="rupi-surface-header"><div><h2>Account</h2></div></div><div className="rupi-detail-grid"><div className="rupi-detail-cell"><span>Name</span><strong>{user.name || "Rupi member"}</strong></div><div className="rupi-detail-cell"><span>Email</span><strong>{user.email}</strong></div></div></article><aside className="rupi-surface"><div className="rupi-surface-header"><div><h2>Wallet</h2></div></div><div className="rupi-detail-grid"><div className="rupi-detail-cell"><span>Public address</span><strong>{wallet ? <ShortAddress address={wallet.public_key} /> : "—"}</strong></div><div className="rupi-detail-cell"><span>Status</span><strong>{wallet?.provision_status || "Not provisioned"}</strong></div></div></aside></section><DeleteAccountRequest /></main>;
}
