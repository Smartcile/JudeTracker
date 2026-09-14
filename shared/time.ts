/** Shift an ISO instant by whole minutes (negative to go earlier). */
export function shiftIsoMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Minutes between two ISO instants (later − earlier). */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
}
