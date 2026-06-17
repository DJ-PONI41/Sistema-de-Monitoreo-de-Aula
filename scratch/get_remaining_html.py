with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(3740, len(lines)):
    print(f"{i+1}: {lines[i].strip()}")
