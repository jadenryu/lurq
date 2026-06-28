/**
 * Minimal ambient types for update-notifier v7 (ESM-only, ships no types of its
 * own; the DefinitelyTyped package still targets v6). Covers only the surface
 * lurq uses — extend if we start calling more of its API.
 */
declare module 'update-notifier' {
  interface Package {
    name: string;
    version: string;
  }

  interface Settings {
    pkg: Package;
    /** Milliseconds between background checks. Default: one day. */
    updateCheckInterval?: number;
    /** npm dist-tag to compare against (default 'latest'). */
    distTag?: string;
  }

  interface UpdateInfo {
    latest: string;
    current: string;
    type: 'latest' | 'major' | 'minor' | 'patch' | 'prerelease' | 'build';
    name: string;
  }

  interface UpdateNotifier {
    readonly update?: UpdateInfo;
    fetchInfo(): Promise<UpdateInfo>;
    notify(options?: { defer?: boolean; message?: string; isGlobal?: boolean }): void;
  }

  export default function updateNotifier(settings: Settings): UpdateNotifier;
}
