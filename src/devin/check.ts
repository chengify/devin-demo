import { devinClient } from "./client";
import { logger } from "../observability/logger";

// Read-only connectivity check. Does not create sessions or print session contents.
async function main(): Promise<void> {
  try {
    await devinClient.checkAccess();
    console.log(
      "Devin v3 authentication and organization session-read access verified. No session created.",
    );
    console.log(
      "Creation/termination permissions, repository access, and ACU capacity still require verification.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Devin access check failed.",
    );
    process.exitCode = 1;
  } finally {
    logger.close();
  }
}
void main();
