use zeroize::{Zeroize, ZeroizeOnDrop};

#[cfg(target_os = "windows")]
use std::{os::raw::c_void, ptr};

#[derive(Zeroize, ZeroizeOnDrop, Clone)]
pub struct ObfBox {
    pub(crate) data: Vec<u8>,
    pub(crate) key: Vec<u8>,
}

impl ObfBox {
    pub fn new(raw: &[u8]) -> Self {
        use sha2::{Digest, Sha256};
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};

        // Generate a dynamic rolling XOR mask key stream from runtime seed.
        let mut key = vec![0u8; raw.len()];
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u128(std::time::Instant::now().elapsed().as_nanos());
        let seed = hasher.finish();

        let mut sha = Sha256::new();
        sha.update(seed.to_le_bytes());
        let mut key_stream = sha.finalize().to_vec();

        while key_stream.len() < raw.len() {
            let mut next_sha = Sha256::new();
            next_sha.update(&key_stream);
            key_stream.extend_from_slice(&next_sha.finalize());
        }

        key.copy_from_slice(&key_stream[..raw.len()]);

        let mut data = vec![0u8; raw.len()];
        for (i, (r, k)) in raw.iter().zip(&key).enumerate() {
            data[i] = r ^ k;
        }

        ObfBox { data, key }
    }

    pub fn decrypt(&self) -> Vec<u8> {
        let mut raw = vec![0u8; self.data.len()];
        for (i, (d, k)) in self.data.iter().zip(&self.key).enumerate() {
            raw[i] = d ^ k;
        }
        raw
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

// Windows DPAPI native bindings
#[cfg(target_os = "windows")]
#[repr(C)]
#[allow(non_snake_case)]
struct DATA_BLOB {
    cbData: u32,
    pbData: *mut u8,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn CryptProtectData(
        pDataIn: *const DATA_BLOB,
        szDataDescr: *const u16,
        pOptionalEntropy: *const DATA_BLOB,
        pvReserved: *mut c_void,
        pPromptStruct: *mut c_void,
        dwFlags: u32,
        pDataOut: *mut DATA_BLOB,
    ) -> i32;

    fn CryptUnprotectData(
        pDataIn: *const DATA_BLOB,
        ppszDataDescr: *mut *mut u16,
        pOptionalEntropy: *const DATA_BLOB,
        pvReserved: *mut c_void,
        pPromptStruct: *mut c_void,
        dwFlags: u32,
        pDataOut: *mut DATA_BLOB,
    ) -> i32;
}

#[cfg(target_os = "windows")]
pub fn dpapi_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    let data_in = DATA_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };

    let entropy_bytes = b"AntigravityEntropyPinnacleSecret";
    let entropy_blob = DATA_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };

    let mut data_out = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    unsafe {
        let success = CryptProtectData(
            &data_in,
            ptr::null(),
            &entropy_blob,
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut data_out,
        );

        if success != 0 {
            let result =
                std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

            #[link(name = "kernel32")]
            extern "system" {
                fn LocalFree(hMem: *mut c_void) -> *mut c_void;
            }
            LocalFree(data_out.pbData as *mut c_void);
            Ok(result)
        } else {
            Err("DPAPI encryption failed".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
pub fn dpapi_decrypt(encrypted_data: &[u8]) -> Result<Vec<u8>, String> {
    let data_in = DATA_BLOB {
        cbData: encrypted_data.len() as u32,
        pbData: encrypted_data.as_ptr() as *mut u8,
    };

    let entropy_bytes = b"AntigravityEntropyPinnacleSecret";
    let entropy_blob = DATA_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };

    let mut data_out = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    unsafe {
        let success = CryptUnprotectData(
            &data_in,
            ptr::null_mut(),
            &entropy_blob,
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut data_out,
        );

        if success != 0 {
            let result =
                std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

            #[link(name = "kernel32")]
            extern "system" {
                fn LocalFree(hMem: *mut c_void) -> *mut c_void;
            }
            LocalFree(data_out.pbData as *mut c_void);
            Ok(result)
        } else {
            Err("DPAPI decryption failed".to_string())
        }
    }
}

// Fallback encryption/decryption for non-Windows builds (CI environment targets)
#[cfg(not(target_os = "windows"))]
pub fn dpapi_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mock = data.to_vec();
    for byte in &mut mock {
        *byte ^= 0xA5;
    }
    Ok(mock)
}

#[cfg(not(target_os = "windows"))]
pub fn dpapi_decrypt(encrypted_data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mock = encrypted_data.to_vec();
    for byte in &mut mock {
        *byte ^= 0xA5;
    }
    Ok(mock)
}

// OS Keyring wrappers gated on target OS
#[cfg(target_os = "windows")]
pub fn save_secure_token(key_name: &str, token: &str) -> Result<(), String> {
    let encrypted = dpapi_encrypt(token.as_bytes())?;
    let hex_encrypted = hex::encode(encrypted);

    let entry = keyring::Entry::new("com.antigravity.workspace", key_name)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry
        .set_password(&hex_encrypted)
        .map_err(|e| format!("Failed to save secret to keyring: {}", e))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn save_secure_token(key_name: &str, token: &str) -> Result<(), String> {
    let env_var = format!("MOCK_{}", key_name.to_uppercase());
    std::env::set_var(env_var, token);
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn load_secure_token(key_name: &str) -> Result<ObfBox, String> {
    let entry = keyring::Entry::new("com.antigravity.workspace", key_name)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    let hex_encrypted = entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve secret from keyring: {}", e))?;

    let encrypted =
        hex::decode(hex_encrypted).map_err(|e| format!("Failed to decode hex secret: {}", e))?;

    let decrypted = dpapi_decrypt(&encrypted)?;
    let obf = ObfBox::new(&decrypted);
    Ok(obf)
}

#[cfg(not(target_os = "windows"))]
pub fn load_secure_token(key_name: &str) -> Result<ObfBox, String> {
    let env_var = format!("MOCK_{}", key_name.to_uppercase());
    if let Ok(key) = std::env::var(&env_var) {
        Ok(ObfBox::new(key.as_bytes()))
    } else if let Ok(key) = std::env::var(key_name.to_uppercase()) {
        Ok(ObfBox::new(key.as_bytes()))
    } else {
        Err(format!("Keyring entry {} not found in environment", env_var))
    }
}

#[cfg(target_os = "windows")]
pub fn delete_secure_token(key_name: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("com.antigravity.workspace", key_name)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    let _ = entry.delete_password();
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn delete_secure_token(key_name: &str) -> Result<(), String> {
    let env_var = format!("MOCK_{}", key_name.to_uppercase());
    std::env::remove_var(env_var);
    Ok(())
}

// Backwards compatibility wrappers
pub fn save_api_token(token: &str) -> Result<(), String> {
    save_secure_token("gemini_api_key", token)
}

pub fn load_api_token() -> Result<ObfBox, String> {
    load_secure_token("gemini_api_key")
}

pub fn delete_api_token() -> Result<(), String> {
    delete_secure_token("gemini_api_key")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_obf_box_obfuscation_and_decrypt() {
        let raw = b"my_super_secret_api_key_12345";
        let obf = ObfBox::new(raw);
        assert_ne!(obf.data, raw);

        let decrypted = obf.decrypt();
        assert_eq!(decrypted, raw);
    }

    #[test]
    fn test_dpapi_roundtrip() {
        let raw = b"test_secret_payload_dpapi";
        let encrypted = dpapi_encrypt(raw).unwrap();
        assert_ne!(encrypted, raw);

        let decrypted = dpapi_decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, raw);
    }

    #[test]
    fn test_keyring_roundtrip() {
        let key = "test_keyring_secret_123";
        save_api_token(key).unwrap();

        let obf = load_api_token().unwrap();
        let decrypted = obf.decrypt();
        assert_eq!(std::str::from_utf8(&decrypted).unwrap(), key);

        let _ = delete_api_token();
    }
}
