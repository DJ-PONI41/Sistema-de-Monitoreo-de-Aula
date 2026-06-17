import re

with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Let's find sections related to dataset generation and training
# For example, look at the body elements
body_start = html.find('<body>')
body_content = html[body_start:]

print("--- INPUTS, SELECTS, AND BUTTONS ---")
inputs = re.findall(r'<(input|select|button)\b[^>]*id="([^"]+)"[^>]*>', body_content)
for tag, idx in inputs:
    print(f"Tag: {tag}, ID: {idx}")

# Also find some headers or section titles
print("\n--- SECTION HEADERS ---")
headers = re.findall(r'<h[23]\b[^>]*>(.*?)</h[23]>', body_content)
for h in headers:
    print(f"Header: {h.strip()}")
