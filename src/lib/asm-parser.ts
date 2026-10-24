export type InstrCategory = "arithmetic" | "load/store" | "control" | "logic" | "other";
export const CATEGORIES: InstrCategory[] = [
  "arithmetic",
  "load/store",
  "control",
  "logic",
  "other",
];

const ARITH =
  /^(add|sub|imul|mul|idiv|div|inc|dec|neg|lea|adc|sbb|addsd|subsd|mulsd|divsd|addss|mulss|addps|mulps|vaddps|vmulps|vfmadd\w*)/;
const MEM = /^(mov\w*|push|pop|ld\w*|st\w*|lw|sw|movs[sd]|cvt\w*)$/;
const CTRL = /^(j\w+|call|ret|loop\w*|b|bl|beq|bne|cmov\w*)$/;
const LOGIC = /^(and|or|xor|not|shl|shr|sal|sar|rol|ror|test|cmp|pxor|xorps|andps)$/;

export interface AsmLine {
  n: number;
  raw: string;
  mnemonic: string | null;
  category: InstrCategory | null; // null for labels/directives/comments
}

export function classify(mnemonic: string): InstrCategory {
  const m = mnemonic.toLowerCase();
  if (CTRL.test(m)) return "control";
  if (MEM.test(m)) return "load/store";
  if (LOGIC.test(m)) return "logic";
  if (ARITH.test(m)) return "arithmetic";
  return "other";
}

export function parseAsm(text: string): AsmLine[] {
  return text.split(/\r?\n/).map((raw, i) => {
    const s = raw.replace(/[#;].*$/, "").trim();
    if (!s || s.endsWith(":") || s.startsWith("."))
      return { n: i + 1, raw, mnemonic: null, category: null };
    const mnemonic = s.split(/\s+/)[0] ?? "";
    return { n: i + 1, raw, mnemonic, category: classify(mnemonic) };
  });
}

export function countCategories(lines: AsmLine[]): Record<InstrCategory, number> {
  const c = { arithmetic: 0, "load/store": 0, control: 0, logic: 0, other: 0 } as Record<
    InstrCategory,
    number
  >;
  lines.forEach((l) => l.category && c[l.category]++);
  return c;
}
