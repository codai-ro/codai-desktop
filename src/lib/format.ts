// SPDX-License-Identifier: Apache-2.0
const utcTimeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function fmtUtcTime(d: Date | string): string {
  return utcTimeFmt.format(typeof d === 'string' ? new Date(d) : d);
}

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function fmtUsd(n: number): string {
  return usdFmt.format(n);
}

const intFmt = new Intl.NumberFormat('en-US');

export function fmtInt(n: number): string {
  return intFmt.format(n);
}
