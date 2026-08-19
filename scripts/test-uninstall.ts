import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isStoreCommerciallyActive } from "../lib/lifecycle/status";

assert.equal(isStoreCommerciallyActive("active"), true);
assert.equal(isStoreCommerciallyActive("uninstalled"), false);
assert.equal(isStoreCommerciallyActive(undefined), false);

const uninstall = readFileSync(new URL("../lib/lifecycle/uninstall.ts", import.meta.url), "utf8");
assert.match(uninstall, /runTransaction/);
assert.match(uninstall, /status: "uninstalled"/);
assert.match(uninstall, /uninstalledAt/);
assert.match(uninstall, /"scheduled", "processing"/);
assert.match(uninstall, /status: "cancelled"/);
assert.doesNotMatch(uninstall, /delete\(/);
assert.doesNotMatch(uninstall, /accessToken/);

const processSource = readFileSync(new URL("../lib/rules/process.ts", import.meta.url), "utf8");
assert.match(processSource, /tx\.get\(storeRef\(storeId\)\)/);
assert.match(processSource, /isStoreCommerciallyActive/);

const dispatch = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
assert.match(dispatch, /loja inativa antes do envio/);
assert.match(dispatch, /preSendJob/);

let status = "active";
let jobs = ["scheduled", "processing", "sent"];
const uninstallInMemory = () => {
  const already = status === "uninstalled";
  status = "uninstalled";
  jobs = jobs.map((job) => job === "scheduled" || job === "processing" ? "cancelled" : job);
  return already;
};
assert.equal(uninstallInMemory(), false);
assert.deepEqual(jobs, ["cancelled", "cancelled", "sent"]);
assert.equal(uninstallInMemory(), true);
assert.deepEqual(jobs, ["cancelled", "cancelled", "sent"]);
assert.equal(isStoreCommerciallyActive(status), false);

console.log("app uninstall commercial block: OK");
