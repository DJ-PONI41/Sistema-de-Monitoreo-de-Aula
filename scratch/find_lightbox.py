import re

with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Let's search for modal or lightbox inside index.html
matches = list(re.finditer(r'id="lightboxModal"|id="imageDetailModal"', html, re.IGNORECASE))
if matches:
    start = matches[0].start()
    # Find enclosing div or print 1500 chars around it
    print(html[start-200:start+1800])
else:
    # try lowercase search
    matches2 = list(re.finditer(r'lightbox', html, re.IGNORECASE))
    if matches2:
        print("Found lightbox keyword at:", [m.start() for m in matches2])
        print(html[matches2[0].start()-100:matches2[0].start()+1000])
