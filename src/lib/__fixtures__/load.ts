import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a fixture next to this file. */
export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

export function jsonFixture(name: string): unknown {
  return JSON.parse(fixture(name));
}
