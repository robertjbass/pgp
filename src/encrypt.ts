import * as openpgp from 'openpgp'

// Config to allow weak keys like DSA (not recommended for production)
const weakKeyConfig = {
  rejectPublicKeyAlgorithms: new Set(),
  rejectHashAlgorithms: new Set(),
  rejectMessageHashAlgorithms: new Set(),
  rejectCurves: new Set(),
}

export async function encryptMessage(message: string, publicKeyArmored: string): Promise<string> {
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored, config: weakKeyConfig })

  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: message }),
    encryptionKeys: publicKey,
    config: weakKeyConfig,
  })

  return encrypted as string
}
