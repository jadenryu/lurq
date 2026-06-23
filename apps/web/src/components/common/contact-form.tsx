"use client";

import { useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CONTACT_EMAIL = "jadenryu@gmail.com";
// Cloudflare's "always passes" test key renders the widget locally; set the real
// NEXT_PUBLIC_TURNSTILE_SITE_KEY (and TURNSTILE_SECRET_KEY on the server) in prod.
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";

type Status = "idle" | "submitting" | "success" | "error";

declare global {
  interface Window {
    turnstile?: { reset: (id?: string) => void };
  }
}

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const token = String(data.get("cf-turnstile-response") ?? "");
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
      window.turnstile?.reset();
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message);
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-border bg-card/60 p-6 text-center">
        <p className="font-medium text-foreground">Thanks — message sent.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll reply to your email shortly.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
      />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="contact-name">Name</Label>
          <Input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
            autoComplete="name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-email">Email</Label>
          <Input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-message">Message</Label>
          <Textarea
            id="contact-message"
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what you're building or asking about…"
          />
        </div>

        {/* Honeypot — hidden from users, bots tend to fill it. */}
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

        {/* Cloudflare Turnstile (injects a hidden cf-turnstile-response field) */}
        <div
          className="cf-turnstile"
          data-sitekey={TURNSTILE_SITE_KEY}
          data-theme="dark"
        />

        <Button type="submit" disabled={status === "submitting"} className="mt-1 w-full">
          {status === "submitting" ? "Sending…" : "Send message"}
        </Button>

        {status === "error" && (
          <p className="text-center text-xs text-destructive">{errorMsg}</p>
        )}

        <p className="text-center text-xs text-muted-foreground/70">
          Goes straight to{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </form>
    </>
  );
}
