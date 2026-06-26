// Cloudflare Turnstile global API (loaded via <script> on demand). Declared in
// one place so the contact form and waitlist dialog share a single Window
// augmentation — duplicate `declare global` blocks with differing shapes break
// the build ("Subsequent property declarations must have the same type").

interface TurnstileOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
}

interface Window {
  turnstile?: {
    render: (el: HTMLElement, opts: TurnstileOptions) => string;
    reset: (id?: string) => void;
    remove: (id?: string) => void;
  };
}
