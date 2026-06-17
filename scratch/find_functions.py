import re

with open(r'c:\Users\Hp\Downloads\backend\backend\scratch\index_js_extracted.js', 'r', encoding='utf-8') as f:
    js_content = f.read()

# Find function declarations: function name(...) or const name = async (...) => or similar
functions = re.findall(r'function\s+(\w+)\s*\(', js_content)
async_arrow = re.findall(r'const\s+(\w+)\s*=\s*async\s*\(', js_content)
arrow = re.findall(r'const\s+(\w+)\s*=\s*\([^\)]*\)\s*=>', js_content)

print("Standard Functions:")
for f in functions:
    print(f"  {f}")

print("\nAsync Arrow Functions:")
for f in async_arrow:
    print(f"  {f}")
