import type { Language } from "./examples";

export interface InputStep {
  prompt: string;
  variable?: string;
}

export interface InputDetection {
  requiresInput: boolean;
  steps: InputStep[];
  reasons: string[];
}

/**
 * Detects whether source code expects standard input across all supported languages,
 * and extracts prompt strings in order of occurrence.
 */
export function detectCodeInputs(language: Language, source: string): InputDetection {
  const steps: InputStep[] = [];
  const reasons: string[] = [];

  // Python
  if (language === "python") {
    const inputMatches = [...source.matchAll(/\binput\s*\(\s*(['"`])(.*?)\1\s*\)/g)];
    inputMatches.forEach((m) => {
      const p = m[2] !== undefined ? m[2] : "";
      steps.push({ prompt: p || "> " });
      reasons.push(`input("${p}")`);
    });
    if (/\binput\s*\(\s*\)/.test(source) && inputMatches.length === 0) {
      steps.push({ prompt: "> " });
      reasons.push("input()");
    }
    if (/\bsys\.stdin\b/.test(source)) {
      steps.push({ prompt: "> " });
      reasons.push("sys.stdin");
    }
  }

  // C / C++
  if (language === "c" || language === "cpp") {
    // Scan line by line or statement by statement to pair cout/printf prompts with cin/scanf
    const lines = source.split("\n");
    let pendingPrompt = "";

    lines.forEach((line) => {
      // Check for prompt output on this line
      const coutMatch = line.match(/(?:std\s*::\s*)?cout\s*<<\s*["']([^"']*)["']/);
      const printfMatch = line.match(/(?:std\s*::\s*)?printf\s*\(\s*["']([^"']*)["']/);
      if (coutMatch) pendingPrompt = coutMatch[1];
      else if (printfMatch) pendingPrompt = printfMatch[1];

      // Check for cin >>
      const cinMatch = line.match(/(?:std\s*::\s*)?cin\s*>>\s*([^;]+)/);
      if (cinMatch) {
        // May contain chained >> e.g. cin >> a >> b
        const vars = cinMatch[1].split(">>").map((v) => v.trim()).filter(Boolean);
        vars.forEach((v, idx) => {
          const pr = idx === 0 && pendingPrompt ? pendingPrompt : "> ";
          steps.push({ prompt: pr, variable: v });
          reasons.push(`cin >> ${v}`);
        });
        pendingPrompt = "";
      }

      // Check for scanf
      const scanfMatch = line.match(/(?:std\s*::\s*)?scanf\s*\(\s*["']([^"']*)["']\s*,\s*([^)]+)/);
      if (scanfMatch) {
        const pr = pendingPrompt || "> ";
        steps.push({ prompt: pr, variable: scanfMatch[2].trim() });
        reasons.push(`scanf("${scanfMatch[1]}")`);
        pendingPrompt = "";
      }

      // Check for getline(cin, ...)
      if (/(?:std\s*::\s*)?getline\s*\(\s*(?:std\s*::\s*)?cin\b/.test(line)) {
        steps.push({ prompt: pendingPrompt || "> " });
        reasons.push("getline(cin)");
        pendingPrompt = "";
      }
    });

    // Fallback if regex didn't catch line-by-line
    if (steps.length === 0 && /(?:std\s*::\s*)?cin\s*>>/.test(source)) {
      steps.push({ prompt: "> " });
      reasons.push("cin");
    }
  }

  // Java
  if (language === "java") {
    const lines = source.split("\n");
    let pendingPrompt = "";

    lines.forEach((line) => {
      const printMatch = line.match(/System\s*\.\s*out\s*\.\s*print(?:ln)?\s*\(\s*["']([^"']*)["']/);
      if (printMatch) pendingPrompt = printMatch[1];

      if (/\b(?:sc|scanner|in)\s*\.\s*next(?:Int|Double|Line|Long)?\s*\(/.test(line)) {
        steps.push({ prompt: pendingPrompt || "> " });
        reasons.push("Scanner input");
        pendingPrompt = "";
      }
    });

    if (steps.length === 0 && /\bScanner\b/.test(source) && /\bSystem\s*\.\s*in\b/.test(source)) {
      steps.push({ prompt: "> " });
      reasons.push("Scanner(System.in)");
    }
  }

  // JavaScript
  if (language === "javascript") {
    const promptMatches = [...source.matchAll(/\b(prompt|input)\s*\(\s*(['"`])(.*?)\2\s*\)/g)];
    promptMatches.forEach((m) => {
      const p = m[3] !== undefined ? m[3] : "";
      steps.push({ prompt: p || "> " });
      reasons.push(`prompt("${p}")`);
    });
    if (/\b(prompt|input)\s*\(/.test(source) && promptMatches.length === 0) {
      steps.push({ prompt: "> " });
      reasons.push("prompt()");
    }
    if (/\breadline\s*\(/.test(source)) {
      steps.push({ prompt: "> " });
      reasons.push("readline()");
    }
  }

  return {
    requiresInput: steps.length > 0 || reasons.length > 0,
    steps,
    reasons,
  };
}
