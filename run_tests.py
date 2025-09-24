#!/usr/bin/env python3
import subprocess, sys, json, os

def main():
    try:
        res = subprocess.run([sys.executable, "-m", "pytest", "-q"], capture_output=True, text=True)
        print(res.stdout)
        if res.returncode != 0:
            print(res.stderr)
        # crude summary extraction
        summary = ""
        for line in (res.stdout or "").splitlines():
            if line.strip().endswith("passed") or "failed" in line:
                summary = line.strip()
        print("\nSUMMARY:", summary)
    except FileNotFoundError:
        print("pytest not found. Run: pip install pytest")

if __name__ == "__main__":
    main()
