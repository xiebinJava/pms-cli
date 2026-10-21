#!/usr/bin/env node
/**
 * Verifies that the Connector and backend copies of the provenance golden
 * vector are byte-for-byte identical. The Connector copy under
 * tests/fixtures/provenance/draft-provenance-v1.json is the canonical
 * authoring location; the backend copy under
 * src/test/resources/fixtures/provenance/draft-provenance-v1.json is a
 * checked-in test-resource duplicate used by Java digest tests.
 *
 * Usage:
 *   node scripts/verify-provenance-fixture-sync.mjs
 *   PMS_BACKEND_ROOT=/path/to/pms-backend node scripts/verify-provenance-fixture-sync.mjs
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const connectorRoot = process.cwd();
const backendRoot = process.env.PMS_BACKEND_ROOT ?? "/Users/fs/Desktop/Project/pms-backend";

const connectorFixture = path.join(connectorRoot, "tests/fixtures/provenance/draft-provenance-v1.json");
const backendFixture = path.join(backendRoot, "src/test/resources/fixtures/provenance/draft-provenance-v1.json");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const [connectorBytes, backendBytes] = await Promise.all([
  readFile(connectorFixture).catch((error) => {
    console.error(`无法读取 Connector golden vector: ${connectorFixture}`);
    throw error;
  }),
  readFile(backendFixture).catch((error) => {
    console.error(`无法读取 backend golden vector: ${backendFixture}`);
    throw error;
  }),
]);

const connectorHash = sha256(connectorBytes);
const backendHash = sha256(backendBytes);

if (connectorHash !== backendHash) {
  console.error("provenance golden vector 不一致");
  console.error(`  connector: ${connectorFixture}`);
  console.error(`  sha256:    ${connectorHash}`);
  console.error(`  backend:   ${backendFixture}`);
  console.error(`  sha256:    ${backendHash}`);
  process.exit(1);
}

console.log("provenance golden vector 一致");
console.log(`  connector: ${connectorFixture}`);
console.log(`  backend:   ${backendFixture}`);
console.log(`  sha256:    ${connectorHash}`);
