// Client-safe (no server imports): used by the settings toast and /clients.

/** "Naprawiono też 4 inne połączenia" - Polish plural for the toast/notice. */
export function fixedOthersLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const noun =
    n === 1
      ? "inne połączenie"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "inne połączenia"
        : "innych połączeń";
  return `Naprawiono też ${n} ${noun}`;
}
