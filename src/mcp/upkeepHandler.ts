/**
 * The upkeep plan for a project, for an agent that is editing it right now.
 *
 * Everything else lurq exposes over MCP is argument-fed or index-backed: the
 * caller sends names and versions, never source, and the same tools work
 * whether lurq runs locally or hosted. This one is different on purpose — it
 * READS THE PROJECT, which is the only way to say "you call this, and it is
 * gone" rather than "a newer version exists". That is why it is registered on
 * the stdio server alone: on the hosted path the files are not there, and a
 * tool that silently answers about nothing is worse than a tool that is absent.
 *
 * The detection itself is `src/fix/domains.ts`, which `lurq fix` runs too. This
 * file is the MCP face of it and nothing more — when the two were the same
 * file, the command line could not reach the dispatch table and quietly grew a
 * second, smaller pipeline of its own.
 */
export {
  runDomains as handleUpkeep,
  type DomainInput as UpkeepInput,
  type DomainReport as UpkeepReport,
  type DomainTarget as UpkeepTarget,
} from '../fix/domains';
