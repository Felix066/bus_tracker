import glob
import os

html_files = glob.glob(r"c:\Users\Asus\OneDrive\Desktop\bus_track\*.html")

script_tag = '  <script src="js/storage-encrypt.js"></script>\n'

for file_path in html_files:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    if "js/storage-encrypt.js" in content:
        continue
        
    # Find <head> and insert right after
    if "<head>" in content:
        content = content.replace("<head>", "<head>\n" + script_tag, 1)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Injected into {file_path}")
