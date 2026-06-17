with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

js_lines = lines[2006:] # line 2007 is index 2006
with open(r'c:\Users\Hp\Downloads\backend\backend\scratch\index_js_extracted.js', 'w', encoding='utf-8') as f:
    f.writelines(js_lines)
print("Extracted JS to scratch/index_js_extracted.js")
