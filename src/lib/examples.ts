// Starter programs for the Code Lab. Every language runs for real —
// these are editable templates, not canned demo results.

export type Language = "c" | "cpp" | "python" | "java" | "javascript";
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
];

export interface Example {
  id: string;
  language: Language;
  title: string;
  description: string;
  source: string;
  /** Optional illustrative assembly listing for the Assembly explorer. */
  asm?: string;
}

const rowAsm = `sum_rows:                       # illustrative x86-64, -O1
    xor     eax, eax                # sum = 0
    xor     ecx, ecx                # i = 0
.Louter:
    xor     edx, edx                # j = 0
.Linner:
    mov     r8, rcx
    imul    r8, r8, 512             # i * N
    add     r8, rdx                 # + j
    mov     r9d, DWORD PTR [rdi+r8*4]  # load a[i][j] (stride 4 B)
    add     eax, r9d
    inc     rdx
    cmp     rdx, 512
    jl      .Linner
    inc     rcx
    cmp     rcx, 512
    jl      .Louter
    ret`;

const colAsm = `sum_cols:                       # illustrative x86-64, -O1
    xor     eax, eax
    xor     edx, edx                # j = 0
.Louter:
    xor     ecx, ecx                # i = 0
.Linner:
    mov     r8, rcx
    imul    r8, r8, 512
    add     r8, rdx
    mov     r9d, DWORD PTR [rdi+r8*4]  # load a[i][j] (stride 2048 B)
    add     eax, r9d
    inc     rcx
    cmp     rcx, 512
    jl      .Linner
    inc     rdx
    cmp     rdx, 512
    jl      .Louter
    ret`;

const bsearchAsm = `binary_search:                  # x86-64, rdi=arr, rsi=len, edx=key
    xor     eax, eax                # low = 0
    dec     rsi                     # high = len - 1
.Lloop:
    cmp     rax, rsi
    jg      .Lnot_found
    lea     rcx, [rax+rsi]
    shr     rcx, 1                  # mid = (low + high) / 2
    mov     r8d, DWORD PTR [rdi+rcx*4] # midval = arr[mid]
    cmp     r8d, edx
    je      .Lfound                 # key == midval
    jl      .Lhigher                # key > midval
    lea     rsi, [rcx-1]            # high = mid - 1
    jmp     .Lloop
.Lhigher:
    lea     rax, [rcx+1]            # low = mid + 1
    jmp     .Lloop
.Lfound:
    mov     eax, ecx                # return mid
    ret
.Lnot_found:
    mov     eax, -1
    ret`;

const dotProdAsm = `dot_product:                    # x86-64, rdi=a, rsi=b, edx=n
    xorpd   xmm0, xmm0              # sum = 0.0
    xor     eax, eax                # i = 0
.Lloop:
    cmp     eax, edx
    jge     .Ldone
    movsd   xmm1, QWORD PTR [rdi+rax*8] # a[i]
    mulsd   xmm1, QWORD PTR [rsi+rax*8] # a[i] * b[i]
    addsd   xmm0, xmm1              # sum += product
    inc     eax
    jmp     .Lloop
.Ldone:
    ret`;

const fibAsm = `fibonacci_loop:                 # x86-64, edi=n
    xor     eax, eax                # a = 0
    mov     edx, 1                  # b = 1
    xor     ecx, ecx                # i = 0
.Lloop:
    cmp     ecx, edi
    jge     .Ldone
    mov     r8, rdx                 # temp = b
    add     rdx, rax                # b = a + b
    mov     rax, r8                 # a = temp
    inc     ecx
    jmp     .Lloop
.Ldone:
    ret`;

const sieveAsm = `sieve_eratosthenes:             # x86-64, rdi=composite, esi=n
    mov     ecx, 2                  # i = 2
.Louter:
    mov     eax, ecx
    imul    eax, ecx                # i * i
    cmp     eax, esi
    jge     .Ldone
    movzx   r8d, BYTE PTR [rdi+rcx] # composite[i]
    test    r8d, r8d
    jnz     .Lnext_i
    mov     edx, eax                # j = i * i
.Linner:
    cmp     edx, esi
    jge     .Lnext_i
    mov     BYTE PTR [rdi+rdx], 1   # composite[j] = true
    add     edx, ecx                # j += i
    jmp     .Linner
.Lnext_i:
    inc     ecx
    jmp     .Louter
.Ldone:
    ret`;


export const EXAMPLES: Example[] = [
  {
    id: "c-row",
    language: "c",
    title: "Row-major matrix sum",
    description: "Traverses a 512×512 int matrix row by row (cache-friendly).",
    source: `#include <stdio.h>
#define N 512
static int a[N][N];

int main(void) {
    long sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            a[i][j] = i + j;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += a[i][j];      /* sequential access */
    printf("sum = %ld\\n", sum);
    return 0;
}`,
    asm: rowAsm,
  },
  {
    id: "c-col",
    language: "c",
    title: "Column-major matrix sum",
    description: "Same work, but walks columns first — large stride, poor spatial locality.",
    source: `#include <stdio.h>
#define N 512
static int a[N][N];

int main(void) {
    long sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            a[i][j] = i + j;
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            sum += a[i][j];      /* stride of N*4 bytes */
    printf("sum = %ld\\n", sum);
    return 0;
}`,
    asm: colAsm,
  },
  {
    id: "c-hello",
    language: "c",
    title: "Echo stdin",
    description: "Reads a line from stdin and prints it back — try the stdin box.",
    source: `#include <stdio.h>

int main(void) {
    char buf[256];
    if (fgets(buf, sizeof buf, stdin))
        printf("you said: %s", buf);
    else
        printf("no input\n");
    return 0;
}`,
  },
  {
    id: "cpp-vec",
    language: "cpp",
    title: "Vector accumulate",
    description: "std::vector sum with std::accumulate.",
    source: `#include <iostream>
#include <numeric>
#include <vector>

int main() {
    std::vector<int> v(1'000'000);
    std::iota(v.begin(), v.end(), 0);
    long long s = std::accumulate(v.begin(), v.end(), 0LL);
    std::cout << "sum = " << s << "\\n";
}`,
    asm: `main:                           # illustrative x86-64, -O2
    push    rbx
    mov     edi, 4000000
    call    operator new(unsigned long)
    mov     rbx, rax
    xor     ecx, ecx
.Liota:
    mov     DWORD PTR [rbx+rcx*4], ecx
    inc     rcx
    cmp     rcx, 1000000
    jne     .Liota
    xor     eax, eax
    xor     ecx, ecx
.Lacc:
    movsx   rdx, DWORD PTR [rbx+rcx*4]
    add     rax, rdx
    inc     rcx
    cmp     rcx, 1000000
    jne     .Lacc
    pop     rbx
    ret`,
  },
  {
    id: "cpp-sort",
    language: "cpp",
    title: "Sort & unique",
    description: "Fill, sort and dedupe a vector — real STL work.",
    source: `#include <algorithm>
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v;
    for (int i = 0; i < 50'000; i++) v.push_back((i * 7) % 997);
    std::sort(v.begin(), v.end());
    v.erase(std::unique(v.begin(), v.end()), v.end());
    std::cout << "unique = " << v.size() << "\\n";
}`,
  },
  {
    id: "py-list",
    language: "python",
    title: "List comprehension sum",
    description: "Interpreted loop — bytecode dispatch dominates.",
    source: `def main():
    data = [i * i for i in range(200_000)]
    total = sum(x % 7 for x in data)
    print("total =", total)

main()`,
  },
  {
    id: "py-stdin",
    language: "python",
    title: "Stdin word count",
    description: "Counts words from stdin — paste text in the stdin box.",
    source: `import sys

text = sys.stdin.read()
words = text.split()
print(f"chars={len(text)} words={len(words)} lines={text.count(chr(10)) + (1 if text and not text.endswith(chr(10)) else 0)}")`,
  },
  {
    id: "java-arr",
    language: "java",
    title: "Array prefix sum",
    description: "JIT-compiled array loop.",
    source: `public class Main {
    public static void main(String[] args) {
        int[] a = new int[1_000_000];
        for (int i = 1; i < a.length; i++) a[i] = a[i - 1] + (i & 3);
        System.out.println("last = " + a[a.length - 1]);
    }
}`,
  },
  {
    id: "java-primes",
    language: "java",
    title: "Sieve of Eratosthenes",
    description: "Count primes below 200_000.",
    source: `public class Main {
    public static void main(String[] args) {
        int n = 200_000;
        boolean[] composite = new boolean[n];
        int count = 0;
        for (int i = 2; i < n; i++) {
            if (!composite[i]) {
                count++;
                for (long j = (long) i * i; j < n; j += i) composite[(int) j] = true;
            }
        }
        System.out.println("primes = " + count);
    }
}`,
    asm: sieveAsm,
  },
  {
    id: "js-fib",
    language: "javascript",
    title: "Iterative Fibonacci",
    description: "Tight scalar loop with no memory traffic.",
    source: `function fib(n) {
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}
console.log("fib(90) =", fib(90).toString());`,
    asm: fibAsm,
  },
  {
    id: "js-sort",
    language: "javascript",
    title: "Sort benchmark",
    description: "Fill and sort 200k numbers — wall time is measured in the worker.",
    source: `const n = 200_000;
const a = Array.from({ length: n }, (_, i) => (i * 1103515245 + 12345) >>> 0);
a.sort((x, y) => x - y);
console.log("median =", a[n >> 1], "max =", a[n - 1]);`,
  },
  {
    id: "js-matrix",
    language: "javascript",
    title: "Matrix multiply",
    description: "Naive N×N multiply — edit N and re-run to see timing change.",
    source: `const N = 128;
const A = Array.from({ length: N }, (_, i) =>
  Array.from({ length: N }, (_, j) => ((i + j) % 17) / 17)
);
const B = Array.from({ length: N }, (_, i) =>
  Array.from({ length: N }, (_, j) => ((i * j) % 13) / 13)
);
const C = Array.from({ length: N }, () => Array(N).fill(0));
for (let i = 0; i < N; i++)
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      C[i][j] += A[i][k] * B[k][j];
let checksum = 0;
for (let i = 0; i < N; i++) checksum += C[i][i];
console.log("trace =", checksum.toFixed(6));`,
  },
];

export const examplesFor = (l: Language) => EXAMPLES.filter((e) => e.language === l);
export const exampleById = (id: string) => EXAMPLES.find((e) => e.id === id);
