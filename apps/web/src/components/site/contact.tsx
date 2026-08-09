"use client";

import { useRef, useState } from "react";
import Script from "next/script";
import {
  CONTACT_BODY,
  CONTACT_EMAIL,
  CONTACT_HEAD,
  CONTACT_SENT,
  CONTACT_SUBMIT,
} from "@/content/copy";
import { REPO_URL } from "@/lib/marketing-copy";

/**
 * The contact form, on the room surface.
 *
 * It posts to the existing /api/contact route, which is already the finished
 * part: Turnstile, a honeypot, per-IP rate limiting and Resend all live there and
 * none of it is duplicated here. What this file adds is the surface. The older
 * components/common/contact-form.tsx is built on the dashboard's shadcn controls
 * and reads as a different product against this ground.
 *
 * The route fails closed without TURNSTILE_SECRET_KEY, so a deployment with no
 * key configured would ship a form that looked fine and silently could not send.
 * With no site key we render the address instead, which at least works.
 */
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";
const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
  (process.env.NODE_ENV === "production" ? null : TURNSTILE_TEST_KEY);

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Boxed fields, on the same hairline the rest of the route is built from. A bare
 * underline left the input's extent to guesswork, so the target you click was
 * invisible until focus. The box is `border-edge` and unfilled, the same token and
 * weight as the FAQ's row rules and the channel list below, so it reads as this
 * page rather than a card borrowed from the dashboard. Focus lights all four sides.
 *
 * 4px on the fields, well under the submit button's `rounded-md`, so the filled
 * control stays the roundest thing here and the outlined ones sit just inside it.
 *
 * A literal `rounded-[4px]` and not `rounded-sm`, because globals.css remaps the
 * whole scale off `--radius: 0.75rem`: `rounded-sm` is 7.2px here and `rounded-md`
 * is 9.6px, not Tailwind's stock 4px and 6px. Set explicitly either way, since
 * Safari picks its own radius for inputs and textareas.
 */
const field =
  "w-full rounded-[4px] border border-edge bg-transparent px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-3 transition-[border-color] focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";
/**
 * Field labels stay, because a form without them is unusable. What went is the
 * mono small-caps: a field called NAME in tracked capitals is styled like a
 * system constant, not like a question being asked of a person.
 */
const label = "block text-[13px] text-ink-3";

/** One reachable channel. Never a phone number and never an office we do not have. */
const CHANNELS: { label: string; value: string; href?: string }[] = [
  { label: "Email", value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
  { label: "Issues", value: "github.com/jadenryu/lurq", href: REPO_URL },
  { label: "Reply", value: "Usually within a day" },
];

const channelValue =
  "text-[13px] text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";

export function Contact() {
  return (
    <section id="contact" className="w-full py-24 min-[900px]:py-32">
      {/* The FAQ's column split, to the pixel. These two sections are the same
          shape of thing: a standing statement on the left, a list of rows on
          the right, and reading as one register is the whole point. */}
      <div className="mx-auto grid w-full max-w-[1180px] gap-12 px-4 min-[900px]:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] min-[900px]:gap-20 min-[768px]:px-6">
        <div className="min-[900px]:sticky min-[900px]:top-28 min-[900px]:self-start">
          <h2
            className="font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.028em",
            }}
          >
            {CONTACT_HEAD}
          </h2>
          <p className="mt-6 max-w-[34ch] text-[14px] leading-[1.6] text-ink-2">{CONTACT_BODY}</p>

          {/* Hairline rows, the same construction as an FAQ item. */}
          <dl className="mt-10 max-w-[34ch] border-t border-edge">
            {CHANNELS.map((c) => (
              <div
                key={c.label}
                className="flex items-baseline justify-between gap-6 border-b border-edge py-3"
              >
                <dt className="text-[13px] text-ink-3">
                  {c.label}
                </dt>
                <dd className="min-w-0 truncate">
                  {c.href ? (
                    <a
                      href={c.href}
                      {...(c.href.startsWith("http")
                        ? { target: "_blank", rel: "noopener" }
                        : {})}
                      className={channelValue}
                      style={{ transitionDuration: "var(--dur-hover)" }}
                    >
                      {c.value}
                    </a>
                  ) : (
                    <span className="text-[13px] text-ink-2">{c.value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          {SITE_KEY ? (
            <Form siteKey={SITE_KEY} />
          ) : (
            // No site key means the route fails closed, so a form here would
            // look fine and silently never send.
            <p className="text-[14px] leading-[1.6] text-ink-2">
              The form is off in this environment. Mail{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-ink underline decoration-edge-lit underline-offset-4 transition-[color,text-decoration-color] hover:decoration-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                style={{ transitionDuration: "var(--dur-hover)" }}
              >
                {CONTACT_EMAIL}
              </a>{" "}
              instead.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Form({ siteKey }: { siteKey: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    // Turnstile writes its token into a hidden input it injects itself.
    const token = String(data.get("cf-turnstile-response") ?? "");

    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          company: data.get("company"),
          token,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Couldn't send. Try again.");
        setStatus("error");
        // The token is single-use; a retry needs a fresh one.
        window.turnstile?.reset();
        return;
      }
      setStatus("sent");
      form.reset();
    } catch {
      setError("Couldn't reach the server. Try again.");
      setStatus("error");
      window.turnstile?.reset();
    }
  }

  if (status === "sent") {
    return (
      <p
        role="status"
        className="border-t border-edge py-6 font-mono text-[13px] leading-[1.6]"
        style={{ color: "var(--held)" }}
      >
        {CONTACT_SENT}
      </p>
    );
  }

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <form onSubmit={onSubmit} className="flex flex-col gap-7">
        <div className="grid gap-7 min-[560px]:grid-cols-2">
          <div>
            <label htmlFor="contact-name" className={label}>
              Name
            </label>
            <input id="contact-name" name="name" autoComplete="name" className={`${field} mt-1`} />
          </div>
          <div>
            <label htmlFor="contact-email" className={label}>
              Email
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className={`${field} mt-1`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-message" className={label}>
            Message
          </label>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={4}
            className={`${field} mt-1 resize-y`}
          />
        </div>

        {/* Honeypot. Real people never fill this; the route treats a filled one
            as a silent success so bots do not learn they were caught. */}
        <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="contact-company">Company</label>
          <input id="contact-company" name="company" tabIndex={-1} autoComplete="off" />
        </div>

        <div ref={widget} className="cf-turnstile" data-sitekey={siteKey} data-theme="dark" />

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={status === "sending"}
            className="inline-flex h-11 shrink-0 items-center rounded-md bg-ink px-5 text-[14px] font-medium text-ground transition-[background-color,opacity] hover:bg-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            style={{ transitionDuration: "var(--dur-hover)" }}
          >
            {status === "sending" ? "Sending…" : CONTACT_SUBMIT}
          </button>
          {error ? (
            <p role="alert" className="font-mono text-[12px]" style={{ color: "var(--conflict)" }}>
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </>
  );
}
