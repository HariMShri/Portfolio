"""Copy approvals you clicked in the digest email from the Worker into Neon.

Runs every 30 minutes in GitHub Actions (sync-approvals.yml) so `apply.py`
finds your decisions without any extra setup on your PC. Logs counts only.
"""
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from job_agent import approvals
from job_agent.store import Store


def main() -> int:
    store = Store.open()
    if store is None:
        print("No database configured (DATABASE_URL); nothing to sync.")
        return 0
    try:
        added, skipped = approvals.sync(store)
        print(f"Synced {added} new approval(s) and {skipped} skip(s); {len(store.pending_approvals())} waiting for apply.py")
    except Exception as error:
        # Don't fail the scheduled job (and email you every 30 minutes) while
        # the Worker is unreachable or not yet redeployed; just say so.
        print(f"Approval sync skipped: the Worker's approvals endpoint isn't available ({error})")
        return 0
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
