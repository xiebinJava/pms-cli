import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_WAIT_MS = 5_000;
const RETRY_MS = 50;

export async function withRefreshLock<T>(identity: string, action: () => Promise<T>): Promise<T> {
  const lockName = createHash("sha256").update(identity).digest("hex");
  const lockPath = join(tmpdir(), "pms-cli-refresh-" + lockName);
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner"), JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }), { encoding: "utf8", flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("PMS 凭据刷新锁忙，请稍后重试");
      await reclaimDeadLock(lockPath);
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function reclaimDeadLock(lockPath: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, "owner"), "utf8")) as { pid?: number };
    if (!owner.pid) return;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        await rm(lockPath, { recursive: true, force: true });
      }
    }
  } catch {
    // A lock being created is left alone; the next attempt will inspect it.
  }
}
