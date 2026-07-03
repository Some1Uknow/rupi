import LandingInteractions from "./LandingInteractions";
import { icons } from "lucide";

type IconName = keyof typeof icons;

function icon(name: IconName) {
  const iconNode = icons[name];
  const children = iconNode
    .map(([tag, attrs]) => {
      const attrString = Object.entries(attrs)
        .map(([key, value]) => {
          const attrName = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
          return `${attrName}="${String(value)}"`;
        })
        .join(" ");
      return `<${tag} ${attrString}></${tag}>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

const landingHtml = String.raw`
<!-- ===================== HEADER ===================== -->
		<header class="site-header" id="top">
			<nav class="nav container">
				<a href="#top" class="brand" aria-label="Rupi home">
					<span class="brand-chip" aria-hidden="true">
						<img src="/brand-kit/rupi-logo.png" alt="" class="brand-logo-img" />
					</span>
					<span class="brand-word">Rupi</span>
				</a>

				<div class="nav-links" id="navLinks">
					<div class="nav-item has-menu">
						<button class="nav-link nav-trigger" aria-expanded="false">
							Services
							<svg viewBox="0 0 24 24" fill="none" class="chev">
								<path
									d="m6 9 6 6 6-6"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
							<div class="mega">
								<a href="#features"
									><span class="mega-t">${icon("FileText")}Invoice</span
									><span class="mega-s">Bill clients in dollars</span></a
								>
								<a href="#features"
									><span class="mega-t">${icon("ArrowDownToLine")}Offramp</span
									><span class="mega-s">Move USDC toward INR</span></a
								>
								<a href="#features"
									><span class="mega-t">${icon("ArrowUpFromLine")}Onramp</span
									><span class="mega-s">Bring money into USDC</span></a
								>
								<a href="#features"
									><span class="mega-t">${icon("TrendingUp")}Yield</span
									><span class="mega-s">Put idle USDC to work</span></a
								>
						</div>
					</div>
					<a class="nav-link" href="#features">Invoices</a>
					<a class="nav-link" href="#pricing">Access</a>
					<a class="nav-link" href="#how">How it works</a>
				</div>

				<div class="nav-right">
					<a href="#pricing" class="pill pill-ink nav-cta">
						Join Waitlist
						<span class="pill-arrow" aria-hidden="true">
							<svg viewBox="0 0 24 24" fill="none">
								<path
									d="M5 12h14M13 6l6 6-6 6"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</span>
					</a>
					<button
						class="hamburger"
						id="hamburger"
						aria-label="Open menu"
						aria-expanded="false"
					>
						<span></span><span></span><span></span>
					</button>
				</div>
			</nav>

			<div class="mobile-sheet" id="mobileSheet">
				<a href="#features">Services</a>
				<a href="#how">How it works</a>
				<a href="#pricing" class="pill pill-ink sheet-cta">Join Waitlist</a>
			</div>
		</header>

		<main>
			<!-- ===================== HERO ===================== -->
			<section class="hero">
				<div class="hero-grid" aria-hidden="true"></div>

				<div class="hero-content container">
					<h1 class="reveal" data-d="1">
						<span>Earn in <span class="stellar-word"><img src="/assets/stellar-logo-black.png" alt="Stellar" /></span>.</span>
						<span class="headline-line">Get paid in INR.</span>
					</h1>
					<p class="hero-sub reveal" data-d="2">
						Rupi lets freelancers and remote workers send USD invoices, receive
						Stellar USDC, track payments automatically, and move funds to INR
						when they need to.
					</p>

					<div class="hero-actions reveal" data-d="3">
						<a href="#pricing" class="pill pill-ink pill-lg btn-icon">
							${icon("MailPlus")}
							Join Waitlist
							<span class="pill-arrow lime"
								><svg viewBox="0 0 24 24" fill="none">
									<path
										d="M5 12h14M13 6l6 6-6 6"
										stroke="#1d1d1d"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg></span
							>
						</a>
						<a href="#how" class="pill pill-ghost pill-lg btn-icon">
							${icon("ListChecks")}
							See how it works
							<span class="pill-arrow gray"
								><svg viewBox="0 0 24 24" fill="none">
									<path
										d="M5 12h14M13 6l6 6-6 6"
										stroke="#1d1d1d"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg></span
							>
						</a>
					</div>
				</div>

				<!-- Console mockup -->
				<div class="console-wrap container reveal mockscreen-narrow" data-d="4">
					<div class="glow glow-lime" aria-hidden="true"></div>
					<div class="glow glow-ink" aria-hidden="true"></div>

					<div class="console rupi-app">
						<aside class="rupi-app-sidebar">
							<div class="rupi-app-logo">
								<img src="/brand-kit/rupi-logo.png" alt="" class="rupi-app-logo-img" />
								<span>Rupi</span>
							</div>
							<div class="rupi-app-nav-indicator" aria-hidden="true"></div>
							<div class="rupi-app-nav nav-dashboard">${icon("LayoutDashboard")}Dashboard</div>
							<div class="rupi-app-nav nav-invoices">${icon("ReceiptText")}Invoices</div>
							<div class="rupi-app-nav nav-yield">${icon("TrendingUp")}Yield</div>
							<div class="rupi-app-nav nav-cashout">${icon("BanknoteArrowDown")}Offramp</div>
							<div class="rupi-app-section">Account</div>
							<div class="rupi-app-nav">${icon("Settings")}Settings</div>
							<div class="rupi-app-user">
								<strong>Aarav Shah</strong>
								<small>aarav@rupi.in</small>
							</div>
							</aside>
							<div class="rupi-app-main">
								<div class="rupi-app-view view-dashboard">
									<div class="rupi-app-topbar">
										<div><p>Dashboard</p><span>Stellar USDC payments</span></div>
										<button>${icon("Plus")}New invoice</button>
									</div>
									<div class="rupi-app-content">
										<div class="rupi-app-stats">
											<div class="rupi-app-stat">${icon("Wallet")}<span>USDC balance</span><strong>$842.00</strong><small>≈ ₹70,234</small></div>
											<div class="rupi-app-stat">${icon("TrendingUp")}<span>Earned this month</span><strong class="green">+$1.84</strong><small>Blend yield · 4.2% APY</small></div>
											<div class="rupi-app-stat">${icon("Files")}<span>Invoices sent</span><strong>7</strong><small>2 pending · 5 paid</small></div>
												<div class="rupi-app-stat">${icon("IndianRupee")}<span>Offramped</span><strong>₹1.2L</strong><small>last 30 days</small></div>
										</div>
										<div class="rupi-app-yield">
											<div><span>Yield</span><strong>$840.00 earning 4.2% APY</strong><small>Idle USDC can be supplied to Blend from the dashboard.</small></div>
											<div class="rupi-app-toggle"><i></i></div>
										</div>
										<div class="rupi-app-table-head"><strong>Recent invoices</strong><button>${icon("ArrowUpRight")}View all</button></div>
										<div class="rupi-app-table">
											<div class="rupi-app-row muted"><span>Invoice</span><span>Client</span><span>Amount</span><span>Status</span><span>Action</span></div>
												<div class="rupi-app-row"><span>#INV-007</span><span>Acme Inc.</span><span>$400</span><span><b class="paid">Paid</b></span><span>Offramp</span></div>
												<div class="rupi-app-row"><span>#INV-006</span><span>ByteWorks</span><span>$1,200</span><span><b class="sent">Sent</b></span><span>View</span></div>
												<div class="rupi-app-row"><span>#INV-005</span><span>Notion HQ</span><span>$600</span><span><b class="cashout">Offramped</b></span><span>Receipt</span></div>
												<div class="rupi-app-row"><span>#INV-004</span><span>Linear Labs</span><span>$950</span><span><b class="paid">Paid</b></span><span>Yield</span></div>
												<div class="rupi-app-row"><span>#INV-003</span><span>Mercury UI</span><span>$720</span><span><b class="sent">Sent</b></span><span>Remind</span></div>
										</div>
									</div>
								</div>
								<div class="rupi-app-view view-invoices">
									<div class="rupi-app-topbar">
										<div><p>New invoice</p><span>Fill in the details. Your client pays via Stellar USDC.</span></div>
										<button>${icon("Send")}Send to client</button>
									</div>
									<div class="rupi-app-content invoice-builder">
										<div class="rupi-form-panel">
											<h4>Client details</h4>
											<div class="rupi-form-grid"><div><span>Client name</span><b>Acme Inc.</b></div><div><span>Email</span><b>billing@acme.com</b></div></div>
											<h4>Invoice details</h4>
											<div class="rupi-form-grid"><div><span>Invoice number</span><b>INV-2026-008</b></div><div><span>Due date</span><b>10 Jul 2026</b></div></div>
											<div class="rupi-form-wide"><span>Description</span><b>UI design and frontend development for dashboard v2.</b></div>
											<div class="rupi-form-grid"><div><span>Purpose code</span><b>P0802 · Software</b></div><div><span>Payment memo</span><b>RUPI-008</b></div></div>
											<div class="rupi-app-table compact">
												<div class="rupi-app-row muted"><span>Item</span><span>Qty</span><span>Rate</span><span>Total</span><span></span></div>
												<div class="rupi-app-row"><span>UI design</span><span>1</span><span>$800</span><span>$800</span><span></span></div>
												<div class="rupi-app-row"><span>Frontend handoff</span><span>1</span><span>$450</span><span>$450</span><span></span></div>
												<div class="rupi-app-row"><span>QA fixes</span><span>4h</span><span>$50</span><span>$200</span><span></span></div>
											</div>
										</div>
										<div class="invoice-preview">
											<span>Invoice preview</span>
											<strong>Acme Inc.</strong>
											<div><em>UI design</em><b>$800.00</b></div>
											<div><em>Frontend handoff</em><b>$450.00</b></div>
											<div><em>QA fixes</em><b>$200.00</b></div>
											<div><em>Total</em><b>$1,450.00</b></div>
											<small>Pay via Stellar USDC · Memo RUPI-008</small>
										</div>
									</div>
								</div>
									<div class="rupi-app-view view-yield">
										<div class="rupi-app-topbar">
											<div><p>Yield</p><span>Allocate idle Stellar USDC across yield providers.</span></div>
											<button>${icon("Power")}Yield on</button>
										</div>
										<div class="rupi-app-content">
											<div class="yield-hero">
												<span>Current active provider</span>
												<strong>Blend · USDC lending</strong>
												<small>$840 allocated · 4.2% APY · earned $1.84 this month</small>
											</div>
											<div class="rupi-app-stats">
												<div class="rupi-app-stat">${icon("CircleDollarSign")}<span>Total allocated</span><strong>$1,420</strong><small>Across providers</small></div>
												<div class="rupi-app-stat">${icon("Sprout")}<span>Yield earned</span><strong class="green">$3.11</strong><small>This month</small></div>
												<div class="rupi-app-stat">${icon("Clock")}<span>Last rebalance</span><strong>2h</strong><small>ago</small></div>
												<div class="rupi-app-stat">${icon("ShieldCheck")}<span>Mode</span><strong>Conservative</strong><small>USDC-first routing</small></div>
											</div>
												<div class="rupi-app-table">
													<div class="rupi-app-row muted"><span>Provider</span><span>Strategy</span><span>Allocated</span><span>APY</span><span>Status</span></div>
													<div class="rupi-app-row"><span>Blend</span><span>USDC lending</span><span>$840</span><span>4.2%</span><span><b class="paid">Active</b></span></div>
													<div class="rupi-app-row"><span>Aquarius</span><span>Liquidity rewards</span><span>$320</span><span>3.6%</span><span><b class="sent">Available</b></span></div>
													<div class="rupi-app-row"><span>Soroswap</span><span>AMM pools</span><span>$180</span><span>5.1%</span><span><b class="sent">Available</b></span></div>
													<div class="rupi-app-row"><span>DeFindex</span><span>Yield vaults</span><span>$80</span><span>4.8%</span><span><b class="sent">Available</b></span></div>
												</div>
											</div>
									</div>
									<div class="rupi-app-view view-cashout">
										<div class="rupi-app-topbar">
											<div><p>Offramp to INR</p><span>USDC on Stellar to your INR bank path.</span></div>
											<button>${icon("IndianRupee")}Initiate</button>
										</div>
										<div class="rupi-app-content cashout-screen">
											<div class="rate-box"><span>Live rate</span><strong>1 USDC = ₹83.51</strong><small>via Onramp Money quote · updated 30s ago</small></div>
											<div class="cashout-grid">
												<div class="rupi-form-panel">
													<h4>Amount</h4>
													<div class="rupi-form-grid"><div><span>USDC</span><b>400.00</b></div><div><span>You receive</span><b>≈ ₹33,404</b></div></div>
													<div class="rupi-form-grid"><div><span>Fees</span><b>₹208.50</b></div><div><span>Estimated time</span><b>8 minutes</b></div></div>
													<div class="rupi-form-wide"><span>Destination</span><b>HDFC Bank · Aarav Shah · ••••7890</b></div>
													<div class="rupi-form-wide"><span>Compliance record</span><b>Purpose P0802 · PDF receipt generated after transfer</b></div>
												</div>
												<div class="cashout-steps">
													<div><b>1</b><span>Withdraw from Blend</span></div>
													<div><b>2</b><span>Route USDC through Onramp Money</span></div>
													<div><b>3</b><span>Convert USDC to INR</span></div>
													<div><b>4</b><span>Settle INR to HDFC Bank</span></div>
												</div>
										</div>
									</div>
								</div>
							</div>
						</div>
				</div>
			</section>

			<!-- ===================== TRUST STRIP ===================== -->
			<section class="trust container">
				<p class="trust-eyebrow">Built for cross-border work</p>
				<div class="logos">
					<span>Freelancers</span><span>Remote&nbsp;Workers</span><span>Agencies</span
					><span>Stellar&nbsp;USDC</span><span>Blend&nbsp;Yield</span><span>INR&nbsp;Cash-out</span>
				</div>
			</section>

			<!-- ===================== FEATURES ===================== -->
			<section class="features container" id="features">
				<div class="sec-head reveal-s">
					<span class="eyebrow">What Rupi does</span>
					<h2>One place for USD invoices, USDC payments, and INR cash-out</h2>
					<p>
						Create invoices, receive Stellar USDC, match payments by memo, and
						keep a clean record for every client payment.
					</p>
				</div>
				<div class="feature-grid">
					<article class="feat reveal-s">
						<span class="feat-ic">${icon("FilePlus")}</span>
						<h3>Send USD invoices</h3>
						<p>
							Create an invoice with amount, client details, due date, and purpose
							code.
						</p>
					</article>
					<article class="feat reveal-s">
						<span class="feat-ic">${icon("CircleDollarSign")}</span>
						<h3>Get paid in Stellar USDC</h3>
						<p>
							Clients pay your Stellar address in USDC using the invoice memo.
						</p>
					</article>
					<article class="feat reveal-s">
						<span class="feat-ic">${icon("Radar")}</span>
						<h3>Track payments automatically</h3>
						<p>
							Rupi watches Stellar payments and marks invoices paid when the memo
							matches.
						</p>
					</article>
					<article class="feat reveal-s">
						<span class="feat-ic">${icon("ClipboardCheck")}</span>
						<h3>Keep clean records</h3>
						<p>
							Save invoice status, payment hash, purpose code, and cash-out history
							in one place.
						</p>
					</article>
					<article class="feat reveal-s">
						<span class="feat-ic">${icon("ChartNoAxesCombined")}</span>
						<h3>Earn optional yield</h3>
						<p>
							Put idle USDC to work through Blend when yield is enabled.
						</p>
					</article>
					<article class="feat reveal-s">
						<span class="feat-ic">${icon("BanknoteArrowDown")}</span>
						<h3>Cash out to INR</h3>
						<p>
							Send USDC to your exchange deposit address and follow the INR
							withdrawal flow.
						</p>
					</article>
				</div>
			</section>

			<!-- ===================== METRICS BAND ===================== -->
			<section class="metrics-band">
				<div class="container metrics-grid">
					<div class="metric">
						<span class="m-num"
							><span class="counter" data-target="30"
								>0</span
							>s</span
						><span class="m-lab">Payment checks</span>
					</div>
					<div class="metric">
						<span class="m-num"
							>USDC</span
						><span class="m-lab">Stellar payments</span>
					</div>
					<div class="metric">
						<span class="m-num"
							>INR</span
						><span class="m-lab">Cash-out path</span>
					</div>
					<div class="metric">
						<span class="m-num"
							>P0802</span
						><span class="m-lab">Default purpose code</span>
					</div>
				</div>
			</section>

			<!-- ===================== HOW IT WORKS ===================== -->
			<section class="how container" id="how">
				<div class="sec-head reveal-s">
					<span class="eyebrow">How it works</span>
					<h2>From invoice to INR in three simple steps</h2>
				</div>

					<div class="how-rows">
						<div class="how-row reveal-s">
							<div class="how-copy">
								<span class="how-icon">${icon("FileText")}</span>
								<span class="step-no">01</span>
							<h3>Create an invoice</h3>
							<p>
								Add your client, amount, description, due date, and purpose code.
								Rupi creates a public payment link with Stellar USDC instructions.
							</p>
						</div>
					</div>

						<div class="how-row reveal-s">
							<div class="how-copy">
								<span class="how-icon">${icon("BadgeDollarSign")}</span>
								<span class="step-no">02</span>
							<h3>Client pays in USDC</h3>
							<p>
								Your client sends USDC on Stellar. Rupi checks incoming payments and
								matches the memo to the right invoice.
							</p>
						</div>
					</div>

						<div class="how-row reveal-s">
							<div class="how-copy">
								<span class="how-icon">${icon("ArrowLeftRight")}</span>
								<span class="step-no">03</span>
							<h3>Hold, earn, or cash out</h3>
							<p>
								Keep USDC in your Rupi wallet, enable Blend yield for idle funds,
								or move USDC toward INR cash-out when you are ready.
							</p>
						</div>
					</div>
				</div>
			</section>

			<!-- ===================== WAITLIST ===================== -->
			<section class="pricing container" id="pricing">
				<div class="waitlist-card reveal-s">
					<span class="eyebrow">Join waitlist</span>
					<h2>Get early access to Rupi</h2>
					<p>Be first to try USD invoices, Stellar USDC payment tracking, yield, and INR cash-out.</p>
					<form class="waitlist-form" id="waitlistForm">
						<input name="name" type="text" placeholder="Name optional" autocomplete="name" />
						<input name="email" type="email" placeholder="Email address" autocomplete="email" required />
						<button type="submit" class="pill pill-lime">Join Waitlist</button>
					</form>
					<p class="waitlist-message" id="waitlistMessage" role="status"></p>
				</div>
			</section>

			<!-- ===================== CTA BAND ===================== -->
			<section class="cta-band">
				<div class="container cta-inner reveal-s">
					<div class="hero-grid sm" aria-hidden="true"></div>
					<h2>Ready to invoice in USD and receive USDC?</h2>
					<p>
						Join the Rupi waitlist for a simple way to bill clients, track
						Stellar USDC payments, and cash out to INR.
					</p>
					<a href="#pricing" class="pill pill-lime pill-lg btn-icon"
						>Join Waitlist
						<span class="pill-arrow"
							><svg viewBox="0 0 24 24" fill="none">
								<path
									d="M5 12h14M13 6l6 6-6 6"
									stroke="#1d1d1d"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg></span
						>
					</a>
				</div>
			</section>
		</main>

		<!-- ===================== FOOTER ===================== -->
		<footer class="footer">
			<div class="container foot-grid">
					<div class="foot-brand">
						<a href="#top" class="brand">
							<span class="brand-chip">
								<img src="/brand-kit/rupi-logo.png" alt="" class="brand-logo-img" />
							</span>
							<span class="brand-word light">Rupi</span>
						</a>
						<p>USD invoices, Stellar USDC payments, and INR cash-out for cross-border work.</p>
					</div>
				</div>
				<div class="container foot-base">
					<span>© 2026 Rupi</span>
				</div>
		</footer>
`;

export default function Page() {
  return (
    <>
      <LandingInteractions />
      <div dangerouslySetInnerHTML={{ __html: landingHtml }} />
    </>
  );
}
