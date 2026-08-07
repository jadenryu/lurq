"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Cloudflare's "always passes" test key, for local development only.
 *
 * It renders a widget stamped "For testing only. If seen, report to site owner",
 * and the server verifier fails closed without TURNSTILE_SECRET_KEY — so falling
 * back to it in production shipped a form that looked broken *and* couldn't send.
 * In production with no key configured we show the contact address instead, which
 * at least works.
 */
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
  (process.env.NODE_ENV === "production" ? null : TURNSTILE_TEST_KEY);

const CONTACT_EMAIL = "contact@lurq.run";

type Status = "idle" | "submitting" | "success" | "error";

export function ContactForm({ tone = "dark" }: { tone?: "dark" | "paper" }) {
  if (!TURNSTILE_SITE_KEY) return <ContactFallback tone={tone} />;
  return <ContactFormInner tone={tone} />;
}

/** No spam protection configured: send them somewhere that works. */
function ContactFallback({ tone }: { tone: "dark" | "paper" }) {
  const muted = tone === "paper" ? "text-ink-soft" : "text-muted-foreground";
  const strong = tone === "paper" ? "text-ink" : "text-foreground";
  return (
    <div className={cn("font-mono text-[0.8125rem] leading-relaxed", muted)}>
      <p>
        The form needs a Turnstile site key, which this deployment doesn&apos;t have.
        Email works:
      </p>
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className={cn(
          "mt-3 inline-block underline underline-offset-4 transition-colors duration-[120ms]",
          strong,
          tone === "paper" ? "decoration-rule hover:text-mark" : "decoration-border",
        )}
      >
        {CONTACT_EMAIL}
      </a>
    </div>
  );
}

function ContactFormInner({ tone }: { tone: "dark" | "paper" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [token, setToken] = useState("");

  // Render Turnstile *explicitly* (not via the auto-scanned `.cf-turnstile`
  // class): implicit rendering only scans the DOM once at script load, so the
  // widget never reappears after the form unmounts on success and remounts via
  // "Send another". Explicit render + reset keeps every attempt with a live
  // token.
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const showForm = status !== "success";

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;

    function renderWidget() {
      if (cancelled) return;
      const el = widgetRef.current;
      if (!window.turnstile || !el) {
        retry = setTimeout(renderWidget, 150); // script not ready yet
        return;
      }
      if (widgetIdRef.current) return; // already rendered
      setToken("");
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY!,
        theme: tone === "paper" ? "light" : "dark",
        callback: (t) => setToken(t),
        "error-callback": () => setToken(""),
        "expired-callback": () => setToken(""),
      });
    }

    renderWidget();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // widget DOM may already be gone, ignore
        }
      }
      widgetIdRef.current = null;
    };
  }, [showForm, tone]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const company = String(data.get("company") ?? "");

    if (!token) {
      setStatus("error");
      setErrorMsg("Please complete the verification and try again.");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, company, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Something went wrong.");
      }
      setStatus("success");
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message);
      // Turnstile tokens are single-use; the failed attempt spent it. Reset so
      // the next submit gets a fresh token instead of reusing the dead one.
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
      setToken("");
    }
  }

  // The marketing footer is paper now, so the shadcn dark tokens have to be
  // overridden per-field rather than inherited.
  const paper = tone === "paper";
  const field = paper
    ? "border-rule bg-paper text-ink placeholder:text-ink-soft/55 focus-visible:border-mark focus-visible:ring-mark/25"
    : undefined;
  const label = paper
    ? "font-mono text-[0.6875rem] tracking-[0.08em] text-ink-soft"
    : undefined;

  if (status === "success") {
    return (
      <div
        className={cn(
          "rounded p-6 text-center",
          paper
            ? "border border-rule bg-paper"
            : "rounded-lg border border-border bg-card/60",
        )}
      >
        <p className={cn("font-medium", paper ? "text-ink" : "text-foreground")}>
          Thanks, message sent.
        </p>
        <p
          className={cn(
            "mt-1 text-sm",
            paper ? "text-ink-soft" : "text-muted-foreground",
          )}
        >
          We&apos;ll reply to your email shortly.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className={cn(
            "mt-4 text-sm underline underline-offset-2 transition-colors duration-[120ms]",
            paper
              ? "text-ink-soft hover:text-mark"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="contact-name" className={label}>
            Name
          </Label>
          <Input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
            autoComplete="name"
            className={field}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-email" className={label}>
            Email
          </Label>
          <Input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            className={field}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-message" className={label}>
            Message
          </Label>
          <Textarea
            id="contact-message"
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what you're building or asking about…"
            className={field}
          />
        </div>

        {/* Honeypot: hidden from users; bots tend to fill it. */}
        <div aria-hidden className="hidden">
          <label htmlFor="company">Company</label>
          <input
            id="company"
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {/* Cloudflare Turnstile, rendered explicitly into this container */}
        <div ref={widgetRef} />

        <Button
          type="submit"
          disabled={status === "submitting"}
          className={cn(
            "mt-1 w-full",
            paper && "bg-ink text-paper hover:bg-ink/85 focus-visible:ring-mark/40",
          )}
        >
          {status === "submitting" ? "Sending…" : "Send message"}
        </Button>

        {status === "error" && (
          <p
            className={cn(
              "text-center text-xs",
              paper ? "text-conflict" : "text-destructive",
            )}
          >
            {errorMsg}
          </p>
        )}
      </form>
    </>
  );
}
