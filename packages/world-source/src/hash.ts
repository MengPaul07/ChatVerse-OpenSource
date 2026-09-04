/**
 * A small deterministic hash keeps IDs stable in browsers and Node without
 * depending on crypto, filesystem APIs, or platform-specific encodings.
 */
export function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${toHex(first)}${toHex(second)}`;
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${stableHash(value)}`;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
