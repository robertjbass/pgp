import * as openpgp from 'openpgp'

// Config to allow weak keys like DSA (not recommended for production)
const weakKeyConfig = { rejectPublicKeyAlgorithms: new Set() }

export async function decryptMessage(
  encryptedMessage: string,
  privateKeyArmored: string,
  passphrase: string
): Promise<string> {
  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: privateKeyArmored, config: weakKeyConfig }),
    passphrase,
  })

  const message = await openpgp.readMessage({
    armoredMessage: encryptedMessage,
  })

  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
  })

  return decrypted as string
}
