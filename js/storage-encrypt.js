(function() {
  const originalSetItem = Storage.prototype.setItem;
  const originalGetItem = Storage.prototype.getItem;
  
  const SECRET = "BusTrackSecure2026!";
  
  function xorCipher(str) {
    let res = "";
    for(let i = 0; i < str.length; i++) {
      res += String.fromCharCode(str.charCodeAt(i) ^ SECRET.charCodeAt(i % SECRET.length));
    }
    return res;
  }

  // Define which keys to encrypt
  const encryptKeys = ['driverSession', 'userSession', 'adminSession'];

  Storage.prototype.setItem = function(key, value) {
    if (encryptKeys.includes(key)) {
      try {
        // Obfuscate and encode to base64
        const encrypted = btoa(xorCipher(value));
        originalSetItem.call(this, key, encrypted);
      } catch(e) {
        originalSetItem.call(this, key, value);
      }
    } else {
      originalSetItem.call(this, key, value);
    }
  };

  Storage.prototype.getItem = function(key) {
    const value = originalGetItem.call(this, key);
    if (!value) return value;
    
    if (encryptKeys.includes(key)) {
      // If it starts with { it's plain JSON (legacy session before encryption)
      if (value.trim().startsWith('{')) return value;
      try {
        return xorCipher(atob(value));
      } catch(e) {
        return value; 
      }
    }
    return value;
  };
})();
