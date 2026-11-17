/**
 * Outside's account commands — for this Mac's terminal only, never the web.
 * Whoever can run these can already read the data directory, so they need
 * no sign-in.
 *
 *   npm run accounts                       # list accounts
 *   npm run accounts -- sign-out <name>    # end every session of one account
 *   npm run accounts -- delete <name>      # delete an account and everything saved to it
 *
 * Production accounts by default; add --dev for the dev server's.
 * OUTSIDE_DATA_DIR points it elsewhere.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultDataDir, openAccountsDatabase } from "../src/server/context";
import { deleteUser, endOtherSessions, findUserByName, listUsers } from "../src/server/accounts";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const [command, target] = args.filter((a) => !a.startsWith("--"));
const dir = process.env.OUTSIDE_DATA_DIR || defaultDataDir(dev ? "development" : "production");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function open() {
  if (!existsSync(join(dir, "outside.db"))) fail(`No accounts yet at ${dir}. (--dev for the dev server's.)`);
  return openAccountsDatabase(dir);
}

function findOrFail(db: ReturnType<typeof open>, name: string | undefined) {
  if (!name) fail(`Whose? npm run accounts -- ${command} <name>`);
  return findUserByName(db, name) ?? fail(`No account named "${name}".`);
}

const date = (t: number) => new Date(t).toISOString().slice(0, 10);

switch (command) {
  case undefined:
  case "list": {
    const users = listUsers(open());
    if (users.length === 0) console.log("No accounts.");
    for (const u of users) {
      const by = u.createdByLogin ? ` by ${u.createdByLogin}` : " on this Mac";
      console.log(`${u.username.padEnd(20)} ${u.passkeys} passkey${u.passkeys === 1 ? " " : "s"}  made ${date(u.createdAt)}${by}`);
    }
    break;
  }
  case "sign-out": {
    const db = open();
    const user = findOrFail(db, target);
    const n = endOtherSessions(db, user.id, null);
    console.log(`✓ ${user.username} is signed out of ${n} browser${n === 1 ? "" : "s"}.`);
    break;
  }
  case "delete": {
    const db = open();
    const user = findOrFail(db, target);
    deleteUser(db, user.id);
    console.log(`✓ Deleted ${user.username}, its passkeys and everything saved to it.`);
    break;
  }
  default: {
    const header = readFileSync(new URL(import.meta.url), "utf8").split("*/")[0];
    console.log(header.replace(/^\/\*\*\n?/, "").replace(/^ \* ?/gm, ""));
    process.exit(1);
  }
}
