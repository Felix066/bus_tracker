import os

files = [
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\js\chat.js",
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\js\session-protection.js",
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\js\driver-auth.js",
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\js\admin-sos.js",
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\js\admin-dashboard.js",
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\driver-login.html",
    r"c:\Users\Asus\OneDrive\Desktop\bus_track\admin-dashboard.html"
]

for file_path in files:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    content = content.replace("localStorage.getItem('adminSession')", "sessionStorage.getItem('adminSession')")
    content = content.replace('localStorage.getItem("adminSession")', 'sessionStorage.getItem("adminSession")')
    content = content.replace("localStorage.setItem('adminSession'", "sessionStorage.setItem('adminSession'")
    content = content.replace('localStorage.setItem("adminSession"', 'sessionStorage.setItem("adminSession"')
    content = content.replace("localStorage.removeItem('adminSession')", "sessionStorage.removeItem('adminSession')")
    content = content.replace('localStorage.removeItem("adminSession")', 'sessionStorage.removeItem("adminSession")')

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Updated {file_path}")
