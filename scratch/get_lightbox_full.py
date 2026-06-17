with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

start = html.find('id="lightboxModal"')
if start != -1:
    end = html.find('<script>', start)
    with open(r'c:\Users\Hp\Downloads\backend\backend\scratch\lightbox_extracted.html', 'w', encoding='utf-8') as outf:
        outf.write(html[start-50:end])
    print("Saved lightbox to scratch/lightbox_extracted.html")
else:
    print("Not found")
