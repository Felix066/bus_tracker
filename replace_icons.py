import os
import re

svg_template = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 500" width="1em" height="1em" style="vertical-align: middle;{extra_style}">
  <defs><clipPath id="w-clip"><rect x="0" y="100" width="600" height="400" /></clipPath></defs>
  <g clip-path="url(#w-clip)"><path fill="none" stroke="currentColor" stroke-width="48" stroke-linecap="round" stroke-linejoin="round" d="M 30,60 L 150,300 L 250,100 L 350,300 L 420,160" /></g>
  <g transform="translate(480, 50) rotate(63.4)"><path fill="currentColor" fill-rule="evenodd" d="M 0,-38 A 38,38 0 1,1 -38,0 L -55,-55 Z M 0,-14 A 14,14 0 1,0 0,14 A 14,14 0 1,0 0,-14 Z" /></g>
</svg>"""

def replace_bus_icons():
    base_dir = r"c:\Users\Asus\OneDrive\Desktop\bus_track"
    for filename in os.listdir(base_dir):
        if filename.endswith(".html"):
            filepath = os.path.join(base_dir, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            def replacer(match):
                style_match = re.search(r'style="([^"]*)"', match.group(0))
                extra_style = " " + style_match.group(1) if style_match else ""
                return svg_template.replace("{extra_style}", extra_style)

            new_content = re.sub(r'<i[^>]*fa-bus[^>]*>.*?</i>', replacer, content)
            
            # Also look for any actual bus emojis 🚌 and replace them just in case
            new_content = new_content.replace("🚌", replacer(re.match(r'<i class="fas fa-bus"></i>', '<i class="fas fa-bus"></i>')))

            if new_content != content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated {filename}")

if __name__ == "__main__":
    replace_bus_icons()
