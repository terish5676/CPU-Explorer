// Simplified, educational 5-stage in-order pipeline model (IF ID EX MEM WB).
// Not cycle-accurate for any real CPU. No branch prediction: the fetch unit
// stalls after every branch until the branch resolves in EX.

export type Op = "ADD" | "SUB" | "AND" | "OR" | "ADDI" | "LW" | "SW" | "BEQ" | "BNE" | "NOP";
export const STAGES = ["IF", "ID", "EX", "MEM", "WB"] as const;
export type Stage = (typeof STAGES)[number];

export interface Instr {
  line: number;
  text: string;
  op: Op;
  rd?: number;
  rs?: number;
  rt?: number;
  imm?: number;
  label?: string; // branch target
}

export interface PipelineOptions {
  forwarding: boolean;
  singleMemoryPort: boolean; // structural hazard: IF and MEM share one memory port
  maxDynamic: number;
}

export interface DynInstr {
  seq: number;
  staticIndex: number;
  instr: Instr;
  taken?: boolean;
  times: Record<Stage, number>; // cycle the instruction ENTERS each stage (1-based)
  stalls: { cycles: number; reason: string }[];
  deps: { reg: number; producerSeq: number }[];
}

export interface PipelineResult {
  dyn: DynInstr[];
  totalCycles: number;
  instructionCount: number;
  stallCycles: { data: number; control: number; structural: number; total: number };
  cpi: number;
  registers: number[];
  truncated: boolean;
}

export interface ParseResult {
  program: Instr[];
  labels: Record<string, number>;
  errors: string[];
}

const REG = /^[Rr]([0-7])$/;
const reg = (t: string | undefined) => {
  const m = t?.trim().match(REG);
  return m ? Number(m[1]) : null;
};

export function parseProgram(text: string): ParseResult {
  const program: Instr[] = [];
  const labels: Record<string, number> = {};
  const errors: string[] = [];
  const pending: { line: number; label: string }[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1;
    let s = raw.replace(/[#;].*/, "").trim();
    if (!s) return;
    const lm = s.match(/^([A-Za-z_]\w*):\s*(.*)$/);
    if (lm) {
      if (labels[lm[1]] !== undefined) errors.push(`Line ${line}: duplicate label "${lm[1]}".`);
      labels[lm[1]] = program.length;
      s = lm[2].trim();
      if (!s) return;
    }
    const [mn, ...rest] = s.split(/\s+/);
    const op = mn.toUpperCase() as Op;
    const args = rest
      .join(" ")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const bad = (m: string): void => {
      errors.push(`Line ${line}: ${m}`);
    };
    const ins: Instr = { line, text: s, op };
    switch (op) {
      case "ADD":
      case "SUB":
      case "AND":
      case "OR": {
        const [d, a, b] = args.map(reg);
        if (args.length !== 3 || d === null || a === null || b === null)
          return bad(`${op} expects "rd, rs, rt" (R0–R7).`);
        Object.assign(ins, { rd: d, rs: a, rt: b });
        break;
      }
      case "ADDI": {
        const d = reg(args[0]),
          a = reg(args[1]),
          imm = Number(args[2]);
        if (args.length !== 3 || d === null || a === null || !Number.isInteger(imm))
          return bad(`ADDI expects "rd, rs, imm".`);
        Object.assign(ins, { rd: d, rs: a, imm });
        break;
      }
      case "LW":
      case "SW": {
        const r = reg(args[0]);
        const m = args[1]?.match(/^(-?\d+)\(\s*([Rr][0-7])\s*\)$/);
        if (args.length !== 2 || r === null || !m) return bad(`${op} expects "rX, offset(rY)".`);
        if (op === "LW") Object.assign(ins, { rd: r, rs: reg(m[2])!, imm: Number(m[1]) });
        else Object.assign(ins, { rt: r, rs: reg(m[2])!, imm: Number(m[1]) });
        break;
      }
      case "BEQ":
      case "BNE": {
        const a = reg(args[0]),
          b = reg(args[1]);
        if (args.length !== 3 || a === null || b === null || !/^[A-Za-z_]\w*$/.test(args[2]))
          return bad(`${op} expects "rs, rt, label".`);
        Object.assign(ins, { rs: a, rt: b, label: args[2] });
        pending.push({ line, label: args[2] });
        break;
      }
      case "NOP":
        if (args.length) return bad("NOP takes no operands.");
        break;
      default:
        return bad(`unknown instruction "${mn}".`);
    }
    program.push(ins);
  });
  pending.forEach((p) => {
    if (labels[p.label] === undefined) errors.push(`Line ${p.line}: undefined label "${p.label}".`);
  });
  if (!program.length && !errors.length) errors.push("Program is empty.");
  return { program, labels, errors };
}

const readsOf = (i: Instr): number[] => {
  switch (i.op) {
    case "ADD":
    case "SUB":
    case "AND":
    case "OR":
    case "BEQ":
    case "BNE":
    case "SW":
      return [i.rs!, i.rt!];
    case "ADDI":
    case "LW":
      return [i.rs!];
    default:
      return [];
  }
};
const writes = (i: Instr): number | null => (i.rd !== undefined && i.rd !== 0 ? i.rd : null);
const isMem = (i: Instr) => i.op === "LW" || i.op === "SW";
const isBranch = (i: Instr) => i.op === "BEQ" || i.op === "BNE";

export function simulatePipeline(
  parsed: ParseResult,
  opts: PipelineOptions,
  initialRegs: number[] = [0, 0, 0, 0, 0, 0, 0, 0],
): PipelineResult {
  if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
  const { program, labels } = parsed;
  const regs = [...initialRegs];
  regs[0] = 0;
  const mem = new Map<number, number>();

  // 1) Functional execution -> dynamic instruction stream
  const stream: { idx: number; taken?: boolean }[] = [];
  let pc = 0;
  let truncated = false;
  while (pc < program.length) {
    if (stream.length >= opts.maxDynamic) {
      truncated = true;
      break;
    }
    const i = program[pc];
    let next = pc + 1;
    let taken: boolean | undefined;
    switch (i.op) {
      case "ADD":
        regs[i.rd!] = regs[i.rs!] + regs[i.rt!];
        break;
      case "SUB":
        regs[i.rd!] = regs[i.rs!] - regs[i.rt!];
        break;
      case "AND":
        regs[i.rd!] = regs[i.rs!] & regs[i.rt!];
        break;
      case "OR":
        regs[i.rd!] = regs[i.rs!] | regs[i.rt!];
        break;
      case "ADDI":
        regs[i.rd!] = regs[i.rs!] + i.imm!;
        break;
      case "LW":
        regs[i.rd!] = mem.get(regs[i.rs!] + i.imm!) ?? 0;
        break;
      case "SW":
        mem.set(regs[i.rs!] + i.imm!, regs[i.rt!]);
        break;
      case "BEQ":
        taken = regs[i.rs!] === regs[i.rt!];
        if (taken) next = labels[i.label!];
        break;
      case "BNE":
        taken = regs[i.rs!] !== regs[i.rt!];
        if (taken) next = labels[i.label!];
        break;
    }
    regs[0] = 0;
    stream.push({ idx: pc, taken });
    pc = next;
  }

  // 2) Timing model using stage-entry cycles
  const dyn: DynInstr[] = [];
  const lastWriter = new Map<number, number>();
  const memCycles = new Set<number>();
  const stall = { data: 0, control: 0, structural: 0 };

  stream.forEach(({ idx, taken }, k) => {
    const ins = program[idx];
    const prev = dyn[k - 1];
    const stalls: DynInstr["stalls"] = [];
    // IF: previous instruction must have left IF; after a branch, wait until it resolves in EX.
    let IF = prev ? prev.times.ID : 1;
    if (prev && isBranch(prev.instr)) {
      const resolved = prev.times.EX + 1;
      if (resolved > IF) {
        stalls.push({
          cycles: resolved - IF,
          reason: "Control hazard: fetch waits for branch to resolve in EX",
        });
        stall.control += resolved - IF;
        IF = resolved;
      }
    }
    if (opts.singleMemoryPort) {
      let s = 0;
      while (memCycles.has(IF)) {
        IF++;
        s++;
      }
      if (s) {
        stalls.push({
          cycles: s,
          reason: "Structural hazard: memory port busy with an earlier LW/SW",
        });
        stall.structural += s;
      }
    }
    const ID = Math.max(IF + 1, prev ? prev.times.EX : 0);
    // EX: operands must be available
    let EX = Math.max(ID + 1, prev ? prev.times.MEM : 0);
    const deps: DynInstr["deps"] = [];
    let dataReady = 0;
    for (const r of readsOf(ins)) {
      if (r === 0) continue;
      const p = lastWriter.get(r);
      if (p === undefined) continue;
      const pd = dyn[p];
      deps.push({ reg: r, producerSeq: p });
      const ready = opts.forwarding
        ? pd.instr.op === "LW"
          ? pd.times.MEM + 1
          : pd.times.EX + 1
        : pd.times.WB + 1; // register file written in first half, read in second half of WB cycle
      dataReady = Math.max(dataReady, ready);
    }
    if (dataReady > EX) {
      const s = dataReady - EX;
      stalls.push({
        cycles: s,
        reason: `Data hazard (RAW) on ${deps.map((d) => "R" + d.reg).join(", ")}${opts.forwarding ? " — load-use cannot be fully forwarded" : " — waiting for write-back (forwarding off)"}`,
      });
      stall.data += s;
      EX = dataReady;
    }
    const MEM = Math.max(EX + 1, prev ? prev.times.WB : 0);
    const WB = Math.max(MEM + 1, prev ? prev.times.WB + 1 : 0);
    if (isMem(ins)) memCycles.add(MEM);
    const w = writes(ins);
    if (w !== null) lastWriter.set(w, k);
    dyn.push({
      seq: k,
      staticIndex: idx,
      instr: ins,
      taken,
      times: { IF, ID, EX, MEM, WB },
      stalls,
      deps,
    });
  });

  const totalCycles = dyn.length ? dyn[dyn.length - 1].times.WB : 0;
  const n = dyn.length;
  const total = stall.data + stall.control + stall.structural;
  return {
    dyn,
    totalCycles,
    instructionCount: n,
    stallCycles: { ...stall, total },
    cpi: n ? totalCycles / n : 0,
    registers: regs,
    truncated,
  };
}

/** Stage occupied by instruction at a given cycle ("stall" if waiting in a stage beyond 1 cycle). */
export function stageAt(d: DynInstr, cycle: number): { stage: Stage; stalled: boolean } | null {
  const t = d.times;
  if (cycle < t.IF || cycle > t.WB) return null;
  const order: [Stage, number, number][] = [
    ["IF", t.IF, t.ID],
    ["ID", t.ID, t.EX],
    ["EX", t.EX, t.MEM],
    ["MEM", t.MEM, t.WB],
    ["WB", t.WB, t.WB + 1],
  ];
  for (const [s, start, end] of order) {
    if (cycle >= start && cycle < end) return { stage: s, stalled: cycle > start };
  }
  return null;
}

export const SAMPLE_PROGRAMS: Record<string, { label: string; text: string; note: string }> = {
  raw: {
    label: "RAW dependency chain",
    note: "Back-to-back dependent ALU ops plus a load-use pair.",
    text: `ADDI R1, R0, 5
ADDI R2, R0, 7
ADD  R3, R1, R2
SUB  R4, R3, R1
SW   R4, 0(R0)
LW   R5, 0(R0)
ADD  R6, R5, R2   # load-use hazard
OR   R7, R6, R1`,
  },
  independent: {
    label: "Independent instructions",
    note: "No dependencies — near-ideal pipelining.",
    text: `ADDI R1, R0, 1
ADDI R2, R0, 2
ADDI R3, R0, 3
ADDI R4, R0, 4
ADD  R5, R1, R0
ADD  R6, R2, R0`,
  },
  loop: {
    label: "Counted loop (control hazards)",
    note: "BNE back-edge executed 3 times — fetch stalls until each branch resolves.",
    text: `      ADDI R1, R0, 3     # counter
      ADDI R2, R0, 0     # sum
loop: ADD  R2, R2, R1
      ADDI R1, R1, -1
      BNE  R1, R0, loop
      SW   R2, 0(R0)`,
  },
  memory: {
    label: "Memory-heavy (structural)",
    note: "Enable the single memory port option to see IF/MEM conflicts.",
    text: `ADDI R1, R0, 8
SW   R1, 0(R0)
SW   R1, 4(R0)
LW   R2, 0(R0)
LW   R3, 4(R0)
ADD  R4, R2, R3
SW   R4, 8(R0)`,
  },
};
