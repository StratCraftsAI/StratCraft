# Assembly Verification Checklist

Reference:  - C++ Executor Benchmark Framework
Reference: modernc_quant.md #35 - Branch Hints

## Purpose

Verify that compiler hints and optimizations are actually applied in the generated assembly. Compilers may ignore hints due to inlining decisions or heuristics.

## Running the Audit

```bash
# Generate assembly and analyze
./scripts/audit_assembly.sh

# Output in benchmark/results/assembly/
```

## Verification Checklist

### 1. Branch Hints

**`[[likely]]` Verification**:

```cpp
// Source
if (price > sma) [[likely]] {
    // Common path
}
```

**Expected Assembly**:
- Common path should be fall-through (no jump)
- Unlikely path should have forward jump

```asm
; Good: likely path is fall-through
cmp     rax, rbx
jle     .L_unlikely       ; Jump over unlikely code
; likely path here (no jump needed)
...
.L_unlikely:
; unlikely code at end
```

**Check Command**:
```bash
grep -A5 "cmp.*price.*sma" on_bar.asm
# Verify jump is forward (jle/jl/jg etc with .L+ label)
```

### 2. Hot Function Placement

**`[[gnu::hot]]` Verification**:

```cpp
[[gnu::hot]] void process_bar(const Bar& bar);
```

**Expected**:
- Hot functions clustered together in `.text` section
- Early addresses in symbol table

**Check Command**:
```bash
nm --numeric-sort StratCraft-executor | grep -E "process_bar|on_bar|execute"
# Addresses should be close together
```

**Verification**:
- Address difference < 4KB between hot functions = Good
- Address difference > 64KB = Functions may cause iTLB misses

### 3. Inlining Verification

**Expected Inline**:
```cpp
[[gnu::always_inline]] inline double fast_sma(const double* data, size_t n);
```

**Check**:
```bash
grep -c "call.*fast_sma" on_bar.asm
# Result should be 0 (no calls = fully inlined)
```

**If Calls Present**:
- Function too large
- Recursion
- Virtual function
- Address taken

### 4. SIMD Usage

**Expected SIMD Operations**:
```cpp
// Vectorizable loop
for (size_t i = 0; i < n; ++i) {
    sum += data[i];
}
```

**Check Command**:
```bash
grep -cE "(vmov|vpadd|vmul|vadd|vsub|vpand|vpor|vfmadd)" on_bar.asm
```

**Expected**:
- AVX/AVX2: `vmov`, `vpadd`, `vmul`, `vfmadd`
- SSE: `movaps`, `addps`, `mulps`

**If Missing**:
- Check `-march=native` in compile flags
- Ensure data is aligned
- Check loop trip count is known

### 5. Exception Handling

**Hot Path Should Have**:
- No `_Unwind_*` calls
- No `__cxa_throw`
- No `__cxa_begin_catch`

**Check Command**:
```bash
grep -c "_Unwind\|__cxa" hot_path.asm
# Result should be 0 for hot path functions
```

**If Present**:
- Add `noexcept` to functions
- Use `std::expected` instead of exceptions
- Check all called functions are `noexcept`

### 6. Virtual Function Calls

**Hot Path Should Have**:
- No indirect calls through vtable

**Check Command**:
```bash
grep -c "call.*\*%" on_bar.asm
# Indirect calls - should be minimal on hot path
```

**Pattern**:
```asm
; Virtual call pattern (BAD on hot path)
mov     rax, QWORD PTR [rdi]        ; Load vtable
call    QWORD PTR [rax+offset]      ; Indirect call
```

**Fix**:
- Use `std::variant` + `std::visit`
- Use CRTP for static polymorphism
- Final classes allow devirtualization

### 7. Memory Allocation

**Check for malloc/new**:
```bash
grep -c "malloc\|_Znwm\|_Znam\|operator new" on_bar.asm
# Result should be 0 for hot path
```

**If Present**:
- Pre-allocate containers
- Use PMR pools
- Stack allocate small objects

### 8. Prefetch Instructions

**If Using Manual Prefetch**:
```cpp
__builtin_prefetch(&data[i + distance], 0, 3);
```

**Check**:
```bash
grep -c "prefetch" process_bar.asm
```

**Expected**:
- `prefetcht0` for L1
- `prefetcht1` for L2
- `prefetchnta` for streaming

### 9. Loop Unrolling

**Check Unrolled Loops**:
```bash
# Count loop iterations in assembly
grep -c "add.*rax" inner_loop.asm
# Multiple adds with constant offsets = unrolled
```

**Pattern**:
```asm
; Unrolled loop (4 iterations)
vmovapd ymm0, [rdi]
vmovapd ymm1, [rdi+32]
vmovapd ymm2, [rdi+64]
vmovapd ymm3, [rdi+96]
```

### 10. Register Allocation

**Check Spills**:
```bash
grep -c "QWORD PTR \[rsp" hot_function.asm
# Many stack accesses = register pressure
```

**If Excessive Spills**:
- Reduce local variables
- Split function
- Use `register` hint (limited effect)

## Automated Checks

### CI Script

```bash
#!/bin/bash
# ci_assembly_check.sh

BINARY="./StratCraft-executor"
FAIL=0

# Extract hot path assembly
objdump -d -C $BINARY > full.asm

# Check 1: No exceptions on hot path
if grep -q "_Unwind\|__cxa" full.asm; then
    echo "WARN: Exception handling code present"
fi

# Check 2: No virtual calls on hot path
VCALLS=$(grep -c "call.*\*%" full.asm)
if [ "$VCALLS" -gt 10 ]; then
    echo "WARN: $VCALLS indirect calls (possible virtual functions)"
fi

# Check 3: SIMD present
SIMD=$(grep -cE "(vmov|vpadd|vmul|vadd)" full.asm)
if [ "$SIMD" -lt 100 ]; then
    echo "WARN: Only $SIMD SIMD instructions (expected more)"
fi

# Check 4: No malloc on hot path
MALLOCS=$(grep -c "malloc\|_Znwm" full.asm)
echo "INFO: $MALLOCS allocation calls found"

exit $FAIL
```

## Common Issues

### Issue: `[[likely]]` Not Respected

**Symptom**: Jump for common path.

**Causes**:
1. Profile-guided optimization overrides
2. Compiler heuristics disagree
3. LTO reordered code

**Solution**:
- Use `-fno-reorder-blocks`
- Use PGO with representative workload
- Check with `-fno-lto`

### Issue: Function Not Inlined

**Symptom**: `call` instruction present.

**Causes**:
1. Function too large
2. Different translation unit
3. Address taken

**Solution**:
- Move to header
- Use LTO
- Use `__attribute__((flatten))`

### Issue: SIMD Not Used

**Symptom**: Scalar instructions in vectorizable loop.

**Causes**:
1. Unknown trip count
2. Pointer aliasing
3. Data not aligned

**Solution**:
- Use `#pragma omp simd`
- Add `restrict` keyword
- Use `alignas(32)`

## Reference: Common Instructions

### Good (Performance)

```asm
vmovapd  ; Aligned vector move
vfmadd   ; Fused multiply-add
prefetcht0 ; L1 prefetch
```

### Neutral

```asm
mov      ; Scalar move
add/sub  ; Arithmetic
cmp/test ; Comparison
jcc      ; Conditional jump
```

### Warning (May Impact Performance)

```asm
call     ; Function call
div/idiv ; Division (slow)
lock     ; Atomic prefix
mfence   ; Memory barrier
```

### Bad (Avoid on Hot Path)

```asm
cpuid    ; Serializing, VM Exit
syscall  ; System call
_Unwind  ; Exception handling
malloc   ; Heap allocation
```
