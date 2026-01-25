import {
  getPassword,
  setPassword,
  deletePassword,
} from 'cross-keychain'

const SERVICE_NAME = 'lpgp'

/**
 * Get the account name for a keypair's passphrase.
 * Uses the fingerprint as a unique identifier.
 */
function getAccountName(keypairFingerprint: string): string {
  return `passphrase:${keypairFingerprint}`
}

/**
 * Store a passphrase for a keypair in the system keychain.
 */
export async function storePassphrase(
  keypairFingerprint: string,
  passphrase: string
): Promise<boolean> {
  try {
    await setPassword(SERVICE_NAME, getAccountName(keypairFingerprint), passphrase)
    return true
  } catch (error) {
    // Keychain may not be available on all systems
    return false
  }
}

/**
 * Retrieve a stored passphrase for a keypair from the system keychain.
 * Returns null if not found or keychain is unavailable.
 */
export async function getStoredPassphrase(
  keypairFingerprint: string
): Promise<string | null> {
  try {
    const passphrase = await getPassword(SERVICE_NAME, getAccountName(keypairFingerprint))
    return passphrase ?? null
  } catch (error) {
    // Keychain may not be available or password not found
    return null
  }
}

/**
 * Delete a stored passphrase for a keypair from the system keychain.
 */
export async function deleteStoredPassphrase(
  keypairFingerprint: string
): Promise<boolean> {
  try {
    await deletePassword(SERVICE_NAME, getAccountName(keypairFingerprint))
    return true
  } catch (error) {
    // Keychain may not be available or password not found
    return false
  }
}

/**
 * Check if a passphrase is stored for a keypair.
 */
export async function hasStoredPassphrase(
  keypairFingerprint: string
): Promise<boolean> {
  const passphrase = await getStoredPassphrase(keypairFingerprint)
  return passphrase !== null
}

/**
 * Check if the system keychain is available.
 */
export async function isKeychainAvailable(): Promise<boolean> {
  try {
    // Try to access the keychain with a test operation
    // We use a unique test key that won't conflict with real data
    const testAccount = '__lpgp_keychain_test__'
    await setPassword(SERVICE_NAME, testAccount, 'test')
    await deletePassword(SERVICE_NAME, testAccount)
    return true
  } catch (error) {
    return false
  }
}
