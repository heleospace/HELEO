#!/usr/bin/env python3
"""Regenerate flattened/*.flat.sol for Etherscan verification.

`forge flatten` reaches some OpenZeppelin files through both a relative and an
absolute path (because of the ../frontend/node_modules remapping), emits them
twice and renames the duplicates (IERC20_0, IERC20_1). The result does not
compile. This script keeps the first copy of each source file, restores the
original names, and strips local absolute paths from the file headers.

Usage (from Contracts/): python3 scripts/flatten.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ["LEO", "Staking"]
HEADER = re.compile(r"^// (\S+\.sol)$", re.M)


def canonical(path: str) -> str:
    """Same source file, whichever path forge reached it by."""
    return path.split("node_modules/", 1)[-1]


def dedupe(text: str) -> str:
    matches = list(HEADER.finditer(text))
    out = [text[: matches[0].start()] if matches else text]
    seen = set()
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        key = canonical(m.group(1))
        if key in seen:
            continue
        seen.add(key)
        block = text[m.start() : end]
        out.append(block.replace(m.group(1), key, 1))
    merged = "".join(out)
    # Restore names forge suffixed to disambiguate the duplicates.
    return re.sub(r"\b(I?[A-Z][A-Za-z0-9]*)_[0-9]\b", r"\1", merged)


def main() -> int:
    for name in CONTRACTS:
        target = ROOT / "flattened" / f"{name}.flat.sol"
        subprocess.run(
            ["forge", "flatten", f"{name}.sol", "-o", str(target)],
            cwd=ROOT, check=True, stdout=subprocess.DEVNULL,
        )
        target.write_text(dedupe(target.read_text()))
        print(f"Wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
