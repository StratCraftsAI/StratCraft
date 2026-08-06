#!/bin/bash
#
# Assembly audit script for StratCraft executor
#
# Reference: TICKET_174 - C++ Executor Benchmark Framework
# Reference: modernc_quant.md - Assembly Audit
#
# Checks for:
# - Exception handling code (unwind tables)
# - Virtual function calls (vtable lookups)
# - Memory allocations (malloc/new calls)
# - Branch-heavy code patterns

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../../../build"
OUTPUT_DIR="${SCRIPT_DIR}/../results/assembly"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo "StratCraft Assembly Audit"
echo "========================================"
echo ""

# Function to analyze a binary
analyze_binary() {
    local binary=$1
    local name=$(basename "$binary")

    if [[ ! -f "$binary" ]]; then
        echo "[SKIP] Binary not found: $binary"
        return
    fi

    echo "Analyzing: $name"
    echo "----------------------------------------"

    # Generate disassembly
    objdump -d "$binary" > "$OUTPUT_DIR/${name}.asm"

    # Count exception handling
    local exceptions=$(grep -c "_Unwind\|__cxa_throw\|__cxa_begin_catch" "$OUTPUT_DIR/${name}.asm" 2>/dev/null || echo "0")
    echo "  Exception handlers: $exceptions"

    # Count virtual calls (indirect calls through registers)
    local vcalls=$(grep -c "callq.*\*%\|call.*\*%" "$OUTPUT_DIR/${name}.asm" 2>/dev/null || echo "0")
    echo "  Indirect calls:     $vcalls"

    # Count malloc/new calls
    local mallocs=$(grep -c "malloc\|operator new\|_Znwm\|_Znam" "$OUTPUT_DIR/${name}.asm" 2>/dev/null || echo "0")
    echo "  Allocator calls:    $mallocs"

    # Count branch instructions
    local branches=$(grep -cE "^\s+[0-9a-f]+:\s+.*\s+j[a-z]+\s+" "$OUTPUT_DIR/${name}.asm" 2>/dev/null || echo "0")
    local total_insns=$(grep -cE "^\s+[0-9a-f]+:" "$OUTPUT_DIR/${name}.asm" 2>/dev/null || echo "1")
    local branch_pct=$(echo "scale=2; $branches * 100 / $total_insns" | bc)
    echo "  Branch density:     $branch_pct% ($branches / $total_insns)"

    # Check for SIMD instructions
    local simd=$(grep -cE "\s+(vmov|vpadd|vmul|vadd|vsub|vpand|vpor|vpxor|vfmadd)\s+" "$OUTPUT_DIR/${name}.asm" 2>/dev/null || echo "0")
    echo "  SIMD instructions:  $simd"

    # Summary
    echo ""
    {
        echo "Binary: $name"
        echo "Exception handlers: $exceptions"
        echo "Indirect calls: $vcalls"
        echo "Allocator calls: $mallocs"
        echo "Branch density: $branch_pct%"
        echo "SIMD instructions: $simd"
        echo ""
    } >> "$OUTPUT_DIR/audit_summary.txt"
}

# Clear previous summary
> "$OUTPUT_DIR/audit_summary.txt"

# Analyze benchmark binaries
for binary in "$BUILD_DIR/benchmark"/bench_*; do
    analyze_binary "$binary"
done

# Analyze main executor
analyze_binary "$BUILD_DIR/StratCraft-executor"

# Analyze executor library
if [[ -f "$BUILD_DIR/libStratCraft_executor.a" ]]; then
    echo "Analyzing: libStratCraft_executor.a"
    echo "----------------------------------------"

    # Extract object files and analyze
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    ar x "$BUILD_DIR/libStratCraft_executor.a"

    for obj in *.o; do
        if [[ -f "$obj" ]]; then
            objdump -d "$obj" >> "$OUTPUT_DIR/libStratCraft_executor.asm"
        fi
    done

    cd - > /dev/null
    rm -rf "$TEMP_DIR"

    echo "  Disassembly saved to libStratCraft_executor.asm"
    echo ""
fi

echo "========================================"
echo "Assembly Audit Summary"
echo "========================================"
cat "$OUTPUT_DIR/audit_summary.txt"

echo ""
echo "Full disassembly saved to: $OUTPUT_DIR"
echo ""

# Generate hot path analysis
echo "Hot Path Analysis"
echo "----------------------------------------"
echo "Searching for hot path functions..."

# Common hot path function patterns
HOT_PATTERNS="processBar|loadData|execute|serialize"

for asm_file in "$OUTPUT_DIR"/*.asm; do
    if [[ -f "$asm_file" ]]; then
        name=$(basename "$asm_file" .asm)
        hot_funcs=$(grep -E "<.*($HOT_PATTERNS).*>:" "$asm_file" 2>/dev/null | wc -l)
        if [[ $hot_funcs -gt 0 ]]; then
            echo "  $name: $hot_funcs hot path functions"
        fi
    fi
done

echo ""
echo "Audit complete."
