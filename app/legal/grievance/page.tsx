export default function GrievancePage() {
  const email = process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL?.trim();
  return <><h1>Grievance Contact</h1><p>For a payment, custody, privacy, or cash-out concern, {email ? <><a href={`mailto:${email}`}>{email}</a> from your verified Rupi email</> : "use the active grievance contact published by the production deployment"} and include the relevant invoice or cash-out order ID. Do not send account numbers, seed phrases, OTPs, or passkey data by email.</p><p>Rupi will route provider-specific KYC and settlement matters to Onramp while maintaining an audit trail of the request.</p></>;
}
