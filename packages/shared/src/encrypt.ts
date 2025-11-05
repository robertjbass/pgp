import * as openpgp from 'openpgp'

export async function encryptMessage(message: string, publicKeyArmored: string): Promise<string> {
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored })

  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: message }),
    encryptionKeys: publicKey,
  })

  return encrypted as string
}
