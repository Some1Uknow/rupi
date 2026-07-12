import { requireEnrolledUser } from "@/lib/auth";
import { ProductNav } from "@/components/product/ProductNav";

export default async function ProductLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireEnrolledUser();

  return (
    <div className="rupi-product-shell">
      <ProductNav user={user} />
      <div className="rupi-product-main">{children}</div>
    </div>
  );
}
