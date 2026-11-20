#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError, parseArgs, usage } from "./cli-args.ts";
import { runCli } from "./cli-run.ts";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  try {
    const output = await runCli(parseArgs(argv));
    process.stdout.write(`${output}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    if (error instanceof CliError) {
      process.stderr.write(`${usage()}\n`);
    }
    return 1;
  }
}

export function isEntrypoint(entry = process.argv[1]): boolean {
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isEntrypoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
