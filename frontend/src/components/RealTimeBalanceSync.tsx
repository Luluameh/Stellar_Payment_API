"use client";

import React, { useId } from "react";
import { useBalanceSync } from "@/hooks/useBalanceSync";

interface RealTimeBalanceSyncProps {
  merchantId?: string | null;
  apiKey?: string | null;
  address?: string | null;
  horizonUrl?: string;
  pollingInterval?: number;
  className?: string;
}

/**
 * RealTimeBalanceSync
 *
 * Displays live Stellar account balances with:
 * - Polling + optimistic update support via useBalanceSync (issues #955, #956)
 * - Full screen-reader accessibility: aria-live region, aria-label, aria-busy,
 *   role="status", and descriptive per-balance labels (issue #955)
 */
export function RealTimeBalanceSync({
  merchantId,
  apiKey,
  address,
  horizonUrl,
  pollingInterval = 30000,
  className = "",
}: RealTimeBalanceSyncProps) {
  const liveId = useId();

  const {
    balances,
    isLoading,
    lastUpdated,
    error,
    refresh,
    liveRegionText,
    ariaLabel,
  } = useBalanceSync(merchantId, apiKey, {
    address,
    horizonUrl,
    pollingInterval,
    enabled: true,
  });

  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      aria-label={ariaLabel}
      aria-busy={isLoading}
    >
      {/* Hidden live region — announced to screen readers on every update (issue #955) */}
      <div
        id={liveId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveRegionText}
      </div>

      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">
          Real-time Balances
        </h2>
        <button
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh balances"
          aria-describedby={liveId}
          className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {isLoading ? "Syncing…" : "Refresh"}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {/* Balance list */}
      {balances.length === 0 && !isLoading ? (
        <p className="text-xs text-gray-500" aria-live="polite">
          No balances available.
        </p>
      ) : (
        <ul
          role="list"
          aria-label="Account balances"
          className="divide-y divide-gray-100"
        >
          {balances.map((b) => (
            <li
              key={b.code}
              className="flex items-center justify-between py-2"
              // Each item is individually labelled for screen readers (issue #955)
              aria-label={`${b.code} balance: ${b.balance}`}
            >
              <span className="text-sm font-medium text-gray-700">{b.code}</span>
              <span className="text-sm tabular-nums text-gray-900">
                {parseFloat(b.balance).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 7,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Last updated — hidden from visual but readable by AT */}
      {lastUpdated && (
        <p className="mt-3 text-xs text-gray-400">
          <span aria-hidden="true">Updated </span>
          <time dateTime={lastUpdated.toISOString()}>
            {lastUpdated.toLocaleTimeString()}
          </time>
        </p>
      )}
    </section>
  );
}

export default RealTimeBalanceSync;
