import sys
import os

# Add virtual environment site-packages to path dynamically
base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
venv_path = os.path.join(base_dir, "venv", "Lib", "site-packages")
if os.path.exists(venv_path):
    sys.path.insert(0, venv_path)
    print(f"[*] Added virtual environment path to sys.path: {venv_path}")
else:
    print("[!] Warning: virtual environment path not found!")

# Import and run uvicorn
try:
    import uvicorn
    import fastapi
    import mediapipe
    print("[*] Successfully imported uvicorn, fastapi, and mediapipe.")
except ImportError as e:
    print(f"[!] Import error: {e}")
    sys.exit(1)

if __name__ == "__main__":
    # Run uvicorn without reload to preserve sys.path in the same process
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="info")
