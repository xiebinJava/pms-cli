const VALUE_OPTIONS = new Set([
  "scope",
  "keyword",
  "name",
  "filter",
  "page",
  "page-size",
  "format",
  "arguments-json",
  "idempotency-key",
  "preview-operation-id",
  "node-id",
  "view",
  "component",
  "version",
  "context-id",
  "context-version",
  "contract-id",
  "contract-version",
  "request-id",
  "message",
  "after-sequence",
  "cases-file",
  "provider",
  "draft-json",
  "patch-json",
  "variant",
  "owner-id",
  "start-date",
  "end-date",
  "intent",
  "execute-mode",
]);

const BOOLEAN_OPTIONS = new Set(["help", "version", "global", "complete"]);

export interface CliInvocation {
  group: string;
  command?: string;
  positionals: string[];
  options: Record<string, string>;
  filters: Record<string, string>;
}

export class CliArgumentError extends Error {
  readonly name = "CliArgumentError";

  constructor(
    message: string,
    readonly code:
      | "CLI_USAGE"
      | "PREVIEW_REQUIRED"
      | "IDEMPOTENCY_REQUIRED"
      | "RESOURCE_NOT_FOUND"
      | "RESOURCE_AMBIGUOUS" = "CLI_USAGE",
  ) {
    super(message);
  }
}

export function parseCliArguments(argv: string[]): CliInvocation {
  const rawPositionals: string[] = [];
  const options: Record<string, string> = {};
  const filters: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      rawPositionals.push(token);
      continue;
    }

    const normalized = token.startsWith("--") ? token.slice(2) : token.slice(1);
    const equalsIndex = normalized.indexOf("=");
    const name = equalsIndex >= 0 ? normalized.slice(0, equalsIndex) : normalized;
    const inlineValue = equalsIndex >= 0 ? normalized.slice(equalsIndex + 1) : undefined;

    if (!name || (!VALUE_OPTIONS.has(name) && !BOOLEAN_OPTIONS.has(name) && !["h", "v"].includes(name))) {
      throw new CliArgumentError("未知参数: " + token);
    }
    // `--version` is a global boolean, but requirement analysis save also
    // uses `--version <entity-version>`. Prefer the explicit value form when
    // a value follows; a bare flag remains the global CLI version switch.
    if (name === "version" && (inlineValue !== undefined || (argv[index + 1] !== undefined && !argv[index + 1].startsWith("-")))) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.length === 0) throw new CliArgumentError("参数 --version 缺少参数值");
      if (inlineValue === undefined) index += 1;
      if (options[name] !== undefined) throw new CliArgumentError("重复参数: --" + name);
      options[name] = value;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(name) || name === "h" || name === "v") {
      if (inlineValue !== undefined) throw new CliArgumentError("参数 " + token + " 不接受值");
      options[name] = "true";
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith("-") || value.length === 0) {
      throw new CliArgumentError("参数 --" + name + " 缺少参数值");
    }
    if (inlineValue === undefined) index += 1;

    if (name === "filter") {
      const separator = value.indexOf("=");
      const filterKey = separator >= 0 ? value.slice(0, separator).trim() : "";
      const filterValue = separator >= 0 ? value.slice(separator + 1) : "";
      if (!filterKey || filterValue.length === 0) throw new CliArgumentError("参数 --filter 需要 key=value");
      if (filters[filterKey] !== undefined) throw new CliArgumentError("重复参数: --filter " + filterKey);
      filters[filterKey] = filterValue;
      continue;
    }
    if (options[name] !== undefined) throw new CliArgumentError("重复参数: --" + name);
    options[name] = value;
  }

  if (!rawPositionals[0] && options.help === undefined && options.h === undefined && options.version === undefined && options.v === undefined) {
    throw new CliArgumentError("缺少命令");
  }
  return {
    group: rawPositionals[0] ?? "",
    command: rawPositionals[1],
    positionals: rawPositionals.slice(2),
    options,
    filters,
  };
}

export const parseArguments = parseCliArguments;
