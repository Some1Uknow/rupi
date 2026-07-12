import CreateInvoiceForm from "./CreateInvoiceForm";
import { PageHeader } from "@/components/product/Primitives";

export default function NewInvoicePage() {
  return <main className="rupi-page">
    <PageHeader title="New payment link" />
    <section className="rupi-invoice-editor rupi-surface"><div className="rupi-invoice-top"><div><h2>Payment details</h2></div></div><CreateInvoiceForm /></section>
  </main>;
}
