import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const connectorRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendRoot = resolve(
  process.env.PMS_BACKEND_ROOT?.trim() || resolve(connectorRoot, "../pms-backend"),
);
const connectorFixture = resolve(
  connectorRoot,
  "tests/fixtures/provenance/draft-provenance-v1.json",
);
const backendFixture = resolve(
  backendRoot,
  "src/test/resources/fixtures/provenance/draft-provenance-v1.json",
);

const connectorBytes = readFileSync(connectorFixture);
const backendBytes = readFileSync(backendFixture);
if (!connectorBytes.equals(backendBytes)) {
  console.error("provenance golden vector mismatch");
  console.error(`connector: ${connectorFixture}`);
  console.error(`backend:   ${backendFixture}`);
  process.exitCode = 1;
} else {
  console.log(`provenance golden vector synchronized (${connectorBytes.length} bytes)`);
  console.log(`connector: ${connectorFixture}`);
  console.log(`backend:   ${backendFixture}`);
}
