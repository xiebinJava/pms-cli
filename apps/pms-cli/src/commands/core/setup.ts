import { doctor } from "./doctor.js";

export async function setup(env: NodeJS.ProcessEnv = process.env) {
  const report = await doctor(env);
  return {
    ready: report.node.ok && report.baseUrl.ok,
    next: report.credentials.ok ? "pms capabilities --format json" : "pms auth login",
    report,
  };
}
