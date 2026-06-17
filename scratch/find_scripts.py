import re

with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all script tag start positions
matches = list(re.finditer(r'<script\b[^>]*>', content, re.IGNORECASE))
for i, match in enumerate(matches):
    start = match.start()
    line_no = content[:start].count('\n') + 1
    # print up to 100 characters of the tag
    tag_text = content[start:start+100].replace('\n', ' ')
    print(f'Script {i+1} at line {line_no}: {tag_text}...')
