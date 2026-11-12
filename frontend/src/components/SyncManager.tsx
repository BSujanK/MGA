"use client";

import { useEffect } from "react";
import { refreshAccount, useAccount } from "@/lib/account";
import { startSync } from "@/lib/sync";

/** Mounted once in the root layout. Renders nothing; syncs browser data with the account while signed in. */
export function SyncManager() {
  const { user } = useAccount();
  const id = user?.id;
  useEffect(() => {
    if (!id) return;
    return startSync(() => void refreshAccount());
  }, [id]);
  return null;
}
