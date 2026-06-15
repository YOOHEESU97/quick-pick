import CryptoJS from 'crypto-js';

function urlEncode(input: string): string {
  let output = '';
  const exclude = /^[a-zA-Z0-9_.\-~]*$/;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (exclude.test(ch)) {
      output += ch;
    } else {
      output += `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return output;
}

/** el.dhlottery JSESSIONID 기반 AES (encrypt.js 와 동일) */
export function encryptFormData(plainText: string, sessionId: string): string {
  const passPhrase = sessionId.substring(0, 32);
  const salt = CryptoJS.lib.WordArray.random(32);
  const iv = CryptoJS.lib.WordArray.random(16);
  const key = CryptoJS.PBKDF2(passPhrase, salt, {
    keySize: 128 / 32,
    iterations: 1000,
    hasher: CryptoJS.algo.SHA256,
  });
  const encrypted = CryptoJS.AES.encrypt(plainText, key, {
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
    iv,
  });
  const encText =
    CryptoJS.enc.Hex.stringify(salt) +
    CryptoJS.enc.Hex.stringify(iv) +
    encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  return urlEncode(encText);
}

export function decryptFormData(encText: string, sessionId: string): string {
  const passPhrase = sessionId.substring(0, 32);
  const saltHex = encText.substring(0, 64);
  const ivHex = encText.substring(64, 96);
  const cryptText = encText.substring(96);
  const key = CryptoJS.PBKDF2(passPhrase, CryptoJS.enc.Hex.parse(saltHex), {
    keySize: 128 / 32,
    iterations: 1000,
    hasher: CryptoJS.algo.SHA256,
  });
  const decrypted = CryptoJS.AES.decrypt(cryptText, key, {
    iv: CryptoJS.enc.Hex.parse(ivHex),
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}
