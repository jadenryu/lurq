/**
 * `lurq check-release --publish` — file this package's surface under the
 * caller's account.
 *
 * Deliberately independent of the release check it rides on. The check needs a
 * published version to diff against; an internal package has none, and that is
 * the package worth filing. Extracting again here rather than reaching into
 * `checkRelease` costs one local AST walk and keeps the two answers from having
 * to succeed together.
 */
import { EXTRACTOR_VERSION, extractSurface } from '../surface/extract';
import { readManifest } from '../surface/resolve';
import { MissingKeyError, publishSurface, RemoteError } from './remote';

export async function runPublishSurface(dir: string, opts: { json?: boolean } = {}): Promise<void> {
  const manifest = readManifest(dir);
  if (!manifest?.name || !manifest.version) {
    console.error('lurq: --publish needs a package.json with a name and a version.');
    process.exitCode = 1;
    return;
  }

  const surface = extractSurface(dir, { manifest });
  if (surface.undeclaredReason) {
    // Publishing an empty surface would file `undeclared` against a real
    // version, and a later reader cannot tell that apart from a package that
    // genuinely exports nothing. Refuse instead and say what to do.
    console.error(
      `lurq: nothing to publish — ${surface.undeclaredReason}. Build the package first.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await publishSurface(
      { ...surface, version: manifest.version },
      EXTRACTOR_VERSION,
    );
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `\npublished  ${result.package}@${result.version} — ${result.symbolsWritten} symbol(s)\n` +
        '  your agents can now resolve this package by name and version, from evidence.',
    );
  } catch (err) {
    if (err instanceof MissingKeyError) {
      console.error('lurq: --publish needs an API key. Run `npx lurqrun` to sign in.');
    } else if (err instanceof RemoteError) {
      console.error(`lurq: could not publish — ${err.message}`);
    } else {
      throw err;
    }
    process.exitCode = 1;
  }
}
