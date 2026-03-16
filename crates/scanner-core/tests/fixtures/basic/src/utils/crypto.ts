export function hash(value: string): string {
  return `hash:${value}`;
}

export function verify(value: string): boolean {
  return value.startsWith("hash:");
}
