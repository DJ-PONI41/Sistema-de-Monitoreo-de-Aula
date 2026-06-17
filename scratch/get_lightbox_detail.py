with open(r'c:\Users\Hp\Downloads\backend\backend\app\static\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

start = html.find('id="lightboxModal"')
if start != -1:
    end = html.find('</div>', start)
    # search for closing tag of lightbox-modal
    # Let's count nested div tags or print 2500 chars to find it
    print(html[start-50:start+2000])
else:
    print("Not found")
