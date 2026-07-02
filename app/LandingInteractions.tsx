"use client";

import { useEffect } from "react";

export default function LandingInteractions() {
  useEffect(() => {
    const form = document.getElementById("waitlistForm") as HTMLFormElement | null;
    const message = document.getElementById("waitlistMessage");
    if (!form || !message) return;

    const onSubmit = async (event: SubmitEvent) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const formData = new FormData(form);
      const email = String(formData.get("email") || "").trim();
      const name = String(formData.get("name") || "").trim();

      message.className = "waitlist-message";
      message.textContent = "";
      if (!email) {
        message.classList.add("error");
        message.textContent = "Enter your email to join the waitlist.";
        return;
      }

      if (button) {
        button.disabled = true;
        button.textContent = "Joining...";
      }

      try {
        const response = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, source: "landing_page" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Could not join the waitlist right now.");
        }
        form.reset();
        message.classList.add("success");
        message.textContent = "You are on the waitlist. We will reach out when Rupi is ready.";
      } catch (error) {
        message.classList.add("error");
        message.textContent =
          error instanceof Error ? error.message : "Could not join the waitlist right now.";
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Join Waitlist";
        }
      }
    };

    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("submit", onSubmit);
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const burger = document.getElementById("hamburger");
    const sheet = document.getElementById("mobileSheet");
    if (burger && sheet) {
      const onBurgerClick = () => {
        const open = sheet.classList.toggle("open");
        burger.classList.toggle("open", open);
        burger.setAttribute("aria-expanded", String(open));
      };
      burger.addEventListener("click", onBurgerClick);

      const sheetLinks = Array.from(sheet.querySelectorAll("a"));
      const onSheetLinkClick = () => {
        sheet.classList.remove("open");
        burger.classList.remove("open");
        burger.setAttribute("aria-expanded", "false");
      };
      sheetLinks.forEach((link) => {
        link.addEventListener("click", onSheetLinkClick);
      });

      return () => {
        burger.removeEventListener("click", onBurgerClick);
        sheetLinks.forEach((link) => {
          link.removeEventListener("click", onSheetLinkClick);
        });
      };
    }
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealEls = document.querySelectorAll(".reveal, .reveal-s");

    if (reduce) {
      revealEls.forEach((el) => {
        el.classList.add("in");
      });
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );

    revealEls.forEach((el) => {
      io.observe(el);
    });

    return () => {
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function animateCount(el: Element) {
      const target = parseFloat(el.getAttribute("data-target") || "0");
      const dec = parseInt(el.getAttribute("data-dec") || "0", 10);
      const suffix = el.getAttribute("data-suffix") || "";
      if (reduce) {
        el.textContent = target.toFixed(dec) + suffix;
        return;
      }

      const duration = 1500;
      let start: number | null = null;

      function fmt(value: number) {
        const text = dec ? value.toFixed(dec) : Math.round(value).toLocaleString("en-US");
        return text + suffix;
      }

      function step(timestamp: number) {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - (1 - progress) ** 3;
        el.textContent = fmt(target * eased);
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = fmt(target);
        }
      }

      requestAnimationFrame(step);
    }

    const counters = document.querySelectorAll(".counter");
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            cio.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 },
    );

    counters.forEach((counter) => {
      cio.observe(counter);
    });

    return () => {
      cio.disconnect();
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const consoleEl = document.querySelector(".console");
    const chartLine = document.getElementById("chartLine") as SVGGeometryElement | null;

    if (chartLine) {
      const len = chartLine.getTotalLength();
      chartLine.style.strokeDasharray = String(len);
      chartLine.style.strokeDashoffset = reduce ? "0" : String(len);
    }

    if (!consoleEl) return;

    const conIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            consoleEl.classList.add("in");
            if (chartLine && !reduce) {
              chartLine.style.transition =
                "stroke-dashoffset 1.8s cubic-bezier(.2,.7,.2,1) .3s";
              requestAnimationFrame(() => {
                chartLine.style.strokeDashoffset = "0";
              });
            }
            conIo.unobserve(consoleEl);
          }
        });
      },
      { threshold: 0.25 },
    );

    conIo.observe(consoleEl);

    return () => {
      conIo.disconnect();
    };
  }, []);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;

    function onScroll() {
      if (!header) return;
      header.style.borderBottomColor =
        window.scrollY > 8 ? "rgba(0,0,0,.07)" : "transparent";
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
